// PUT /api/admin/prices {groups: [{title, items: [{name, price}]}]}
// Ліміти: до 10 груп, у кожній до 10 послуг (ті самі в site/admin/admin.js).
import { json } from "../../../lib/util.js";

const MAX_GROUPS = 10;
const MAX_ITEMS = 10;
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }
  const groups = body.groups;
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS) return json({ error: `Забагато груп (максимум ${MAX_GROUPS})` }, 400);

  const clean = [];
  for (const g of groups) {
    if (!str(g?.title, 80)) return json({ error: "У кожної групи має бути назва (до 80 символів)" }, 400);
    if (!Array.isArray(g.items) || g.items.length > MAX_ITEMS) return json({ error: `Група «${g.title}»: максимум ${MAX_ITEMS} послуг` }, 400);
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
