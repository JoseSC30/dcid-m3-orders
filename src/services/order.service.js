import { call } from "./http.service.js";
import {
  findOrder,
  changeOrderStatus,
} from "../repositories/order.repository.js";
export async function getOwnedOrder(orderId, userId) {
  const order = await findOrder(orderId);
  if (!order) return null;
  if (String(order.user_id) !== String(userId))
    throw Object.assign(new Error("Sin permiso"), { status: 403 });
  return order;
}
export async function releaseReservation(order) {
  return call(
    process.env.EVENTS_URL,
    `/events/${order.event_id}/sectors/${order.sector_id}/reservations/${order.id}/release`,
    { method: "PATCH" },
  );
}
export async function confirmPaidReservation(order) {
  return call(
    process.env.EVENTS_URL,
    `/events/${order.event_id}/sectors/${order.sector_id}/reservations/${order.id}/confirm`,
    { method: "PATCH" },
  );
}
export async function cancelUnpaidOrder(order) {
  if (order.estado !== "pendiente")
    throw Object.assign(
      new Error("Solo se pueden cancelar órdenes pendientes"),
      { status: 409 },
    );
  await releaseReservation(order);
  return changeOrderStatus(order.id, "cancelada");
}
