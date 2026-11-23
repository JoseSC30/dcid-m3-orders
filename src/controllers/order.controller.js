import { getOwnedOrder, cancelUnpaidOrder } from "../services/order.service.js";
import {
  listUserOrders,
  changeOrderStatus,
} from "../repositories/order.repository.js";
import { validatePurchase } from "../models/order.model.js";
import { run, db } from "../config/database.js";
import { auth, internal } from "../middleware/auth.middleware.js";
import { call } from "../services/http.service.js";
import { log } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
export function registerOrderRoutes(router) {
  router.get("/orders", auth(["cliente"]), async (req, res, next) => {
    try {
      res.json(await listUserOrders(req.user.id));
    } catch (e) {
      next(e);
    }
  });
  router.get("/orders/internal/:id", internal, async (req, res, next) => {
    try {
      const x = await run("SELECT id,estado FROM orders WHERE id=$1", [
        req.params.id,
      ]);
      if (!x.rowCount)
        return res.status(404).json({ error: "Orden no encontrada" });
      res.json(x.rows[0]);
    } catch (e) {
      next(e);
    }
  });
  router.post(
    "/orders/:id/reissue",
    auth(["cliente"]),
    async (req, res, next) => {
      try {
        const x = await run("SELECT * FROM orders WHERE id=$1 AND user_id=$2", [
          req.params.id,
          req.user.id,
        ]);
        if (!x.rowCount)
          return res.status(404).json({ error: "Orden no encontrada" });
        const o = x.rows[0];
        if (o.estado !== "pagada")
          return res.status(409).json({ error: "Orden no pagada" });
        const e = await call(process.env.EVENTS_URL, `/events/${o.event_id}`, {
          internalKey: false,
        });
        const sector = e.sectores.find(
          (s) => String(s.id) === String(o.sector_id),
        );
        const t = await call(process.env.TICKETS_URL, "/tickets/issue", {
          method: "POST",
          body: {
            order_id: o.id,
            user_id: req.user.id,
            event_id: o.event_id,
            event_name: e.nombre,
            sector_name: sector?.nombre || "Sector",
            cantidad: o.cantidad,
          },
        });
        res.json(t);
      } catch (e) {
        next(e);
      }
    },
  );
  router.patch(
    "/orders/:id/cancel",
    auth(["cliente"]),
    async (req, res, next) => {
      try {
        const order = await getOwnedOrder(req.params.id, req.user.id);
        if (!order)
          return res.status(404).json({ error: "Orden no encontrada" });
        res.json(await cancelUnpaidOrder(order));
      } catch (e) {
        next(e);
      }
    },
  );
  router.get("/orders/:id", auth(), async (req, res, next) => {
    try {
      const x = await run("SELECT * FROM orders WHERE id=$1", [req.params.id]);
      if (!x.rowCount)
        return res.status(404).json({ error: "Orden no encontrada" });
      if (String(x.rows[0].user_id) !== String(req.user.id))
        return res.status(403).json({ error: "Sin permiso" });
      res.json(x.rows[0]);
    } catch (e) {
      next(e);
    }
  });
  router.post("/orders", auth(["cliente"]), async (req, res, next) => {
    const {
      evento_id,
      sector_id,
      cantidad,
      payment_method = "CARD",
      card_last4 = "",
    } = req.body;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 6)
      return res.status(400).json({ error: "Máximo 6 entradas por compra" });
    try {
      validatePurchase({
        evento_id,
        sector_id,
        cantidad,
        payment_method,
        card_last4,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    let orderId = "ORD-" + randomUUID();
    let reserved = false;
    let orderSaved = false;
    try {
      const event = await call(process.env.EVENTS_URL, `/events/${evento_id}`, {
        internalKey: false,
      });
      if (event.estado !== "publicado")
        return res.status(400).json({ error: "Evento no publicado" });
      const sector = event.sectores.find(
        (s) => String(s.id) === String(sector_id),
      );
      if (!sector) return res.status(404).json({ error: "Sector inexistente" });
      const amount = (Number(sector.precio) * cantidad).toFixed(2);
      await run(
        "INSERT INTO orders(id,user_id,event_id,sector_id,cantidad,monto,estado) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          orderId,
          req.user.id,
          evento_id,
          sector_id,
          cantidad,
          amount,
          "pendiente",
        ],
      );
      orderSaved = true;
      await call(
        process.env.EVENTS_URL,
        `/events/${evento_id}/sectors/${sector_id}/reservations`,
        { method: "POST", body: { id_orden: orderId, cantidad } },
      );
      reserved = true;
      const p = await call(process.env.PAYMENTS_URL, "/payments", {
        method: "POST",
        body: {
          order_id: orderId,
          amount,
          currency: "BOB",
          payment_method,
          card_last4: String(card_last4),
        },
      });
      if (p.transaction.status === "rejected") {
        await call(
          process.env.EVENTS_URL,
          `/events/${evento_id}/sectors/${sector_id}/reservations/${orderId}/release`,
          { method: "PATCH" },
        );
        await changeOrderStatus(orderId, "rechazada");
        return res
          .status(200)
          .json({ id: orderId, estado: "rechazada", motivo: "Pago rechazado" });
      }
      await changeOrderStatus(orderId, "pagada");
      try {
        await call(
          process.env.EVENTS_URL,
          `/events/${evento_id}/sectors/${sector_id}/reservations/${orderId}/confirm`,
          { method: "PATCH" },
        );
      } catch (e) {
        log("warn", "Reserva pagada pendiente de confirmar: " + e.message);
      }
      let tickets = [];
      let warning = null;
      try {
        const t = await call(process.env.TICKETS_URL, "/tickets/issue", {
          method: "POST",
          body: {
            order_id: orderId,
            user_id: req.user.id,
            event_id: evento_id,
            event_name: event.nombre,
            sector_name: sector.nombre,
            cantidad,
          },
        });
        tickets = t.tickets;
      } catch (e) {
        warning =
          "Pago aprobado, entradas pendientes de generación: " + e.message;
        log("error", warning);
      }
      try {
        if (tickets.length) {
          const me = await call(process.env.AUTH_URL, "/auth/me", {
            token: req.headers.authorization?.replace(/^Bearer /, ""),
            internalKey: false,
          });
          await call(process.env.NOTIFICATIONS_URL, "/notifications/send", {
            method: "POST",
            body: {
              to: me.correo,
              order_id: orderId,
              tickets: [
                "Ingresa a Mis entradas en EntradasYa para descargar tus PDF",
              ],
            },
          });
        }
      } catch (e) {
        log("warn", "Correo no enviado: " + e.message);
      }
      return res
        .status(201)
        .json({ id: orderId, estado: "pagada", tickets, warning });
    } catch (e) {
      log("error", "Compra " + orderId + ": " + e.message);
      if (orderSaved && !reserved && [400, 404, 409].includes(e.status)) {
        await run("UPDATE orders SET estado='rechazada' WHERE id=$1", [
          orderId,
        ]).catch(() => {});
      }
      /* Error técnico: pendiente hasta conciliación, nunca cobrar de nuevo a ciegas */ return res
        .status(e.status === 409 ? 409 : 503)
        .json({
          error: e.message,
          order_id: orderSaved ? orderId : null,
          estado: orderSaved ? "pendiente" : null,
        });
    }
  });
}
