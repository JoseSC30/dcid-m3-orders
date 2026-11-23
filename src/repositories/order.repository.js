import { run } from "../config/database.js";
export async function findOrder(id) {
  return (await run("SELECT * FROM orders WHERE id=$1", [id])).rows[0] || null;
}
export async function listUserOrders(userId) {
  return (
    await run(
      "SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC",
      [userId],
    )
  ).rows;
}
export async function changeOrderStatus(id, estado) {
  return (
    (
      await run("UPDATE orders SET estado=$2 WHERE id=$1 RETURNING *", [
        id,
        estado,
      ])
    ).rows[0] || null
  );
}
