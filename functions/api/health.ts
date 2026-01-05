export const onRequestGet: PagesFunction = () => {
  const body = { ok: true }
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}
