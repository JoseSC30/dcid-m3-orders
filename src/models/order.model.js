export const ORDER_STATES = Object.freeze([
  "pendiente",
  "pagada",
  "rechazada",
  "cancelada",
]);
export function validatePurchase({
  evento_id,
  sector_id,
  cantidad,
  payment_method = "CARD",
  card_last4 = "",
} = {}) {
  if (
    !Number.isInteger(Number(evento_id)) ||
    Number(evento_id) < 1 ||
    !Number.isInteger(Number(sector_id)) ||
    Number(sector_id) < 1
  )
    throw new Error("Evento o sector inválido");
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 6)
    throw new Error("La compra admite de 1 a 6 entradas");
  if (!["CARD", "QR", "BANK_TRANSFER", "WALLET"].includes(payment_method))
    throw new Error("Método de pago inválido");
  if (payment_method === "CARD" && !/^[0-9]{4}$/.test(String(card_last4)))
    throw new Error("Se requieren los últimos 4 dígitos de prueba");
  return true;
}
