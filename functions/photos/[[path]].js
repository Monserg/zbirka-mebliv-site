// GET /photos/<файл> — фото, завантажені через адмінку (зберігаються в KV).
export async function onRequestGet({ params, env }) {
  const key = [].concat(params.path || []).join("/");
  if (!/^[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });
  const { value, metadata } = await env.CONTENT.getWithMetadata(`photo:${key}`, "arrayBuffer");
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: {
      "Content-Type": metadata?.type || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
