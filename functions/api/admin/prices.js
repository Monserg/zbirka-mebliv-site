// PUT /api/admin/prices {groups: [{title, items: [{name, price}]}]}
import { json } from "../../../lib/util.js";

const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }
  const groups = body.groups;
  if (!Array.isArray(groups) || groups.length > 30) return json({ error: "Забагато груп (максимум 30)" }, 400);

  const clean = [];
  for (const g of groups) {
    if (!str(g?.title, 80)) return json({ error: "У кожної групи має бути назва (до 80 символів)" }, 400);
    if (!Array.isArray(g.items) || g.items.length > 60) return json({ error: `Група «${g.title}»: до 60 послуг` }, 400);
    const items = [];
    for (const it of g.items) {
      if (!str(it?.name, 120) || !str(it?.price, 40)) {
        return json({ error: `Група «${g.title}»: у кожної послуги мають бути назва і ціна` }, 400);
      }
      items.push({ name: it.name.trim(), price: it.price.trim() });
    }
    clean.push({ title: g.title.trim(), items });
  }

  await env.CONTENT.put("content:prices", JSON.stringify({ groups: clean }));
  return json({ ok: true });
}
