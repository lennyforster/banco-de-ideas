/* Post-its compartidos en vivo: Yjs (para que los cambios de todos se mezclen bien) + Supabase Realtime (para mandarlos al toque).
   Se usa desde la web (index.html) y desde la página para invitados (vivo.html). */
import * as Y from "https://cdn.jsdelivr.net/npm/yjs@13.6.18/+esm";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm";

const URL_SB = "https://nzgljqcgygzjxpqmvrsh.supabase.co";
const CLAVE_SB = "sb_publishable_1MftcxSIE0_Rb5tT57ikhA_z-FSRkHj"; // clave pública: solo deja usar las funciones vivo_*
let sb = null;
const cliente = () => sb || (sb = createClient(URL_SB, CLAVE_SB, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 30 } } }));

const aB64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const COLORES = ["#e0457b", "#2a7de1", "#1f9d6b", "#e8890c", "#8a4fbf", "#d64545", "#0f9fa8", "#b8860b"];
export const colorDe = n => { let h = 0; for (const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORES[Math.abs(h) % COLORES.length]; };
const nuevoId = () => { const a = "abcdefghijkmnopqrstuvwxyz23456789"; const r = crypto.getRandomValues(new Uint8Array(24)); return [...r].map(x => a[x % a.length]).join(""); };

/* crea un post-it compartido con el texto que tenga y devuelve su código */
export async function crear({ titulo = "", texto = "" }) {
  const id = nuevoId(), doc = new Y.Doc();
  doc.getText("t").insert(0, texto || "");
  const { error } = await cliente().rpc("vivo_crear", { p_id: id, p_titulo: titulo, p_texto: texto || "", p_upd: aB64(Y.encodeStateAsUpdate(doc)) });
  if (error) throw error;
  return id;
}
export async function existe(id) { const { data, error } = await cliente().rpc("vivo_existe", { p_id: id }); if (error) throw error; return !!data; }

/* dónde cae un índice del texto adentro del textarea (para dibujar el cursor de los demás) */
function coordsCaret(ta, i) {
  const cs = getComputedStyle(ta), m = document.createElement("div");
  for (const p of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "boxSizing", "tabSize"]) m.style[p] = cs[p];
  Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", width: ta.clientWidth + "px", left: "-9999px", top: "0" });
  m.textContent = ta.value.slice(0, i); const s = document.createElement("span"); s.textContent = ta.value.slice(i, i + 1) || "​"; m.append(s); document.body.append(m);
  const r = { x: s.offsetLeft, y: s.offsetTop, h: parseFloat(cs.lineHeight) || s.offsetHeight || 20 }; m.remove(); return r;
}

/* conecta un textarea a un post-it compartido.
   op: { id, textarea, nombre, onTexto(texto), onGente(lista), capa (elemento donde dibujar los cursores) } */
export async function conectar(op) {
  const { id } = op; let ta = op.textarea;
  const doc = new Y.Doc(), yt = doc.getText("t"), yo = doc.clientID;
  let nombre = op.nombre || "Alguien", color = colorDe(nombre), cerrado = false;
  const capa = () => op.capa || ta.parentElement;
  let caretsEl = null;
  const pend = [];let tFlush = null;
  const flush = async () => {
    tFlush = null; if (!pend.length) return; const u = Y.mergeUpdates(pend.splice(0));
    const { error } = await cliente().rpc("vivo_cambio", { p_id: id, p_upd: aB64(u), p_texto: yt.toString() });
    if (error) { pend.unshift(u); tFlush = setTimeout(flush, 3000); }
  };
  const ch = cliente().channel("vivo:" + id, { config: { broadcast: { self: false }, presence: { key: String(yo) } } });
  ch.on("broadcast", { event: "u" }, ({ payload }) => { try { Y.applyUpdate(doc, deB64(payload.u), "remoto"); } catch (e) { console.error(e); } });
  ch.on("broadcast", { event: "hola" }, () => { /* alguien entró: le mando todo lo que tengo por si se perdió algo */ ch.send({ type: "broadcast", event: "u", payload: { u: aB64(Y.encodeStateAsUpdate(doc)) } }); });
  ch.on("presence", { event: "sync" }, () => pintarGente());
  doc.on("update", (u, origen) => {
    if (origen === "remoto" || origen === "carga") return;
    ch.send({ type: "broadcast", event: "u", payload: { u: aB64(u) } });
    pend.push(u); clearTimeout(tFlush); tFlush = setTimeout(flush, 500);
  });

  /* textarea <-> texto compartido */
  let rel = null;
  const guardarSel = () => { if (document.activeElement !== ta) return; rel = [Y.createRelativePositionFromTypeIndex(yt, ta.selectionStart), Y.createRelativePositionFromTypeIndex(yt, ta.selectionEnd)]; };
  const alInput = () => {
    const viejo = yt.toString(), nuevo = ta.value; if (viejo === nuevo) return;
    let a = 0; while (a < viejo.length && a < nuevo.length && viejo[a] === nuevo[a]) a++;
    let z = 0; while (z < viejo.length - a && z < nuevo.length - a && viejo[viejo.length - 1 - z] === nuevo[nuevo.length - 1 - z]) z++;
    doc.transact(() => { const borrar = viejo.length - a - z; if (borrar > 0) yt.delete(a, borrar); const ins = nuevo.slice(a, nuevo.length - z); if (ins) yt.insert(a, ins); }, "local");
    guardarSel(); avisarCursor();
  };
  yt.observe(ev => {
    if (ev.transaction.origin === "local") return;
    const enfocado = document.activeElement === ta, r = rel;
    ta.value = yt.toString();
    if (enfocado && r) { const a = Y.createAbsolutePositionFromRelativePosition(r[0], doc), b = Y.createAbsolutePositionFromRelativePosition(r[1], doc); if (a && b) ta.setSelectionRange(a.index, b.index); }
    op.onTexto && op.onTexto(ta.value, true); pintarCursores();
  });
  const enlazar = t => { ta = t; ta.addEventListener("input", alInput); for (const ev of ["keyup", "mouseup", "select", "focus"]) ta.addEventListener(ev, () => { guardarSel(); avisarCursor(); }); ta.addEventListener("blur", () => { avisarCursor(true); }); };
  document.addEventListener("selectionchange", () => { if (!cerrado && document.activeElement === ta) { guardarSel(); avisarCursor(); } });

  /* presencia: quién está y dónde tiene el cursor */
  let tCur = null, ultimoCursor = "";
  function avisarCursor(fuera) {
    if (cerrado) return; clearTimeout(tCur);
    tCur = setTimeout(() => {
      const c = !fuera && document.activeElement === ta ? Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(yt, ta.selectionStart)) : null;
      const est = { n: nombre, c: color, p: c }, s = JSON.stringify(est); if (s === ultimoCursor) return; ultimoCursor = s; ch.track(est);
    }, 120);
  }
  const otros = () => { const st = ch.presenceState(), out = []; for (const k in st) { if (k === String(yo)) continue; const v = st[k][st[k].length - 1]; if (v) out.push({ id: k, ...v }); } return out; };
  function pintarGente() { op.onGente && op.onGente(otros().map(o => ({ nombre: o.n, color: o.c }))); pintarCursores(); }
  function pintarCursores() {
    const c = capa(); if (!c || !ta.isConnected) return;
    if (!caretsEl || caretsEl.parentElement !== c) { caretsEl = document.createElement("div"); caretsEl.className = "vivo-cursores"; c.append(caretsEl); }
    caretsEl.replaceChildren();
    for (const o of otros()) {
      if (!o.p) continue; let abs = null; try { abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(o.p), doc); } catch (_) { }
      if (!abs) continue; const k = coordsCaret(ta, abs.index), b = document.createElement("div"); b.className = "vivo-caret"; b.style.setProperty("--c", o.c || "#e0457b");
      b.style.left = (ta.offsetLeft + k.x - ta.scrollLeft) + "px"; b.style.top = (ta.offsetTop + k.y - ta.scrollTop) + "px"; b.style.height = k.h + "px";
      const e = document.createElement("span"); e.textContent = o.n || "Alguien"; b.append(e); caretsEl.append(b);
    }
  }
  addEventListener("resize", pintarCursores);

  /* arrancar: escuchar, cargar lo guardado y avisar que llegué */
  await new Promise((ok, mal) => { const t = setTimeout(() => mal(new Error("sin conexión en vivo")), 12000); ch.subscribe(s => { if (s === "SUBSCRIBED") { clearTimeout(t); ok(); } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") { clearTimeout(t); mal(new Error(s)); } }); });
  const { data, error } = await cliente().rpc("vivo_leer", { p_id: id }); if (error) throw error;
  if (!data || !data.length) { if (!(await existe(id))) throw new Error("no existe"); }
  for (const f of data || []) { try { Y.applyUpdate(doc, deB64(f.upd), "carga"); } catch (e) { console.error(e); } }
  const titulo = data && data[0] ? data[0].titulo : "";
  if (data && data.length > 120) { const hasta = data[data.length - 1].seq; cliente().rpc("vivo_compactar", { p_id: id, p_estado: aB64(Y.encodeStateAsUpdate(doc)), p_hasta: hasta }); }
  enlazar(ta);
  const local = ta.value;
  ta.value = yt.toString(); op.onTexto && op.onTexto(ta.value, ta.value !== local);
  ch.send({ type: "broadcast", event: "hola", payload: {} });
  avisarCursor(true);
  addEventListener("pagehide", () => { if (pend.length) flush(); });

  return {
    id, titulo,
    texto: () => yt.toString(),
    vincular(t) { if (t === ta) return; enlazar(t); t.value = yt.toString(); pintarCursores(); },
    ponerNombre(n) { nombre = n || "Alguien"; color = colorDe(nombre); ultimoCursor = ""; avisarCursor(); },
    async cerrar() { cerrado = true; clearTimeout(tCur); if (pend.length) await flush(); try { await ch.untrack(); } catch (_) { } cliente().removeChannel(ch); if (caretsEl) caretsEl.remove(); removeEventListener("resize", pintarCursores); }
  };
}

/* el texto más reciente de varios post-its compartidos (para tener al día la plancha) */
export async function textos(ids) { if (!ids.length) return []; const { data, error } = await cliente().rpc("vivo_textos", { p_ids: ids }); if (error) throw error; return data || []; }
