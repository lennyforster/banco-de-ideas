/* Post-its compartidos en vivo: todo lo de adentro del post-it (texto, post-its, notas, links, imágenes, hilos, dibujos)
   se comparte entre varios al mismo tiempo. Yjs mezcla los cambios de todos; Supabase los manda al toque y los guarda. */
import * as Y from "https://cdn.jsdelivr.net/npm/yjs@13.6.18/+esm";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm";

const URL_SB = "https://nzgljqcgygzjxpqmvrsh.supabase.co";
const CLAVE_SB = "sb_publishable_1MftcxSIE0_Rb5tT57ikhA_z-FSRkHj"; // clave pública: solo deja usar las funciones vivo_* y subir imágenes
let sb = null;
const cliente = () => sb || (sb = createClient(URL_SB, CLAVE_SB, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 40 } } }));

const aB64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const COLORES = ["#e0457b", "#2a7de1", "#1f9d6b", "#e8890c", "#8a4fbf", "#d64545", "#0f9fa8", "#b8860b"];
export const colorDe = n => { let h = 0; for (const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORES[Math.abs(h) % COLORES.length]; };
const nuevoId = (n = 24) => { const a = "abcdefghijkmnopqrstuvwxyz23456789"; const r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(""); };
const LISTAS = ["bloques", "hilos", "trazos"];          // se guardan pieza por pieza (por id), así dos personas tocando cosas distintas no se pisan
const SUELTOS = ["tipo", "estado", "numero", "creado", "titulo"];

/* ---------- imágenes (en Supabase, para que las vean todos) ---------- */
export const esImgVivo = id => typeof id === "string" && id.startsWith("sb:");
export const urlImagen = id => URL_SB + "/storage/v1/object/public/vivo/" + id.slice(3);
export async function subirImagen(blob) {
  const tipo = blob.type || "image/jpeg", ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" })[tipo] || "jpg";
  const path = nuevoId(28) + "." + ext;
  const { error } = await cliente().storage.from("vivo").upload(path, blob, { contentType: tipo, upsert: false });
  if (error) throw error; return "sb:" + path;
}

function escribirCampos(doc, campos) {
  const mc = doc.getMap("campos");
  for (const k of SUELTOS) if (campos[k] !== undefined && JSON.stringify(mc.get(k)) !== JSON.stringify(campos[k])) mc.set(k, campos[k]);
  for (const k of LISTAS) if (Array.isArray(campos[k])) ponerLista(doc, k, campos[k]);
}
function ponerLista(doc, k, arr) {
  const m = doc.getMap(k), vistos = new Set(); let o = Date.now();
  arr.forEach((x, i) => {
    if (!x || !x.id) return; vistos.add(x.id); const prev = m.get(x.id);
    const orden = prev ? JSON.parse(prev)._o : o + i; const v = JSON.stringify({ ...x, _o: orden });
    if (prev !== v) m.set(x.id, v);
  });
  for (const id of [...m.keys()]) if (!vistos.has(id)) m.delete(id);
}
function leerLista(doc, k) { const out = []; doc.getMap(k).forEach(v => { try { out.push(JSON.parse(v)); } catch (_) { } }); out.sort((a, b) => (a._o || 0) - (b._o || 0)); return out.map(({ _o, ...x }) => x); }

/* crea un post-it compartido con todo lo que tenga y devuelve su código */
export async function crear(campos) {
  const id = nuevoId(), doc = new Y.Doc();
  doc.transact(() => { doc.getText("t").insert(0, campos.texto || ""); escribirCampos(doc, campos); });
  const { error } = await cliente().rpc("vivo_crear", { p_id: id, p_titulo: campos.titulo || "", p_texto: campos.texto || "", p_upd: aB64(Y.encodeStateAsUpdate(doc)) });
  if (error) throw error; return id;
}
export async function existe(id) { const { data, error } = await cliente().rpc("vivo_existe", { p_id: id }); if (error) throw error; return !!data; }
export async function textos(ids) { if (!ids.length) return []; const { data, error } = await cliente().rpc("vivo_textos", { p_ids: ids }); if (error) throw error; return data || []; }

/* dónde cae un índice del texto adentro de un textarea (para dibujar el cursor de texto de los demás) */
function coordsCaret(ta, i) {
  const cs = getComputedStyle(ta), m = document.createElement("div");
  for (const p of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "boxSizing", "tabSize"]) m.style[p] = cs[p];
  Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", width: ta.clientWidth + "px", left: "-9999px", top: "0" });
  m.textContent = ta.value.slice(0, i); const s = document.createElement("span"); s.textContent = ta.value.slice(i, i + 1) || "​"; m.append(s); document.body.append(m);
  const r = { x: s.offsetLeft, y: s.offsetTop, h: parseFloat(cs.lineHeight) || s.offsetHeight || 20 }; m.remove(); return r;
}

/* abre la sesión en vivo de un post-it compartido */
export async function sesion({ id, nombre }) {
  const doc = new Y.Doc(), yt = doc.getText("t"), yo = doc.clientID;
  let miNombre = nombre || "Alguien", miColor = colorDe(miNombre), cerrado = false;
  const fnsCambio = new Set(), fnsGente = new Set(), fnsMouse = new Set();

  /* guardar: cada cambio propio se manda a los demás y se guarda (agrupado cada medio segundo) */
  const pend = []; let tFlush = null;
  const flush = async () => {
    tFlush = null; if (!pend.length) return; const u = Y.mergeUpdates(pend.splice(0));
    const { error } = await cliente().rpc("vivo_cambio", { p_id: id, p_upd: aB64(u), p_texto: yt.toString() });
    if (error) { pend.unshift(u); tFlush = setTimeout(flush, 3000); }
  };
  const ch = cliente().channel("vivo:" + id, { config: { broadcast: { self: false }, presence: { key: String(yo) } } });
  ch.on("broadcast", { event: "u" }, ({ payload }) => { try { Y.applyUpdate(doc, deB64(payload.u), "remoto"); } catch (e) { console.error(e); } });
  ch.on("broadcast", { event: "hola" }, () => ch.send({ type: "broadcast", event: "u", payload: { u: aB64(Y.encodeStateAsUpdate(doc)) } }));
  const mouses = new Map();
  ch.on("broadcast", { event: "m" }, ({ payload: p }) => { if (!p || p.id === yo) return; if (p.x == null) mouses.delete(p.id); else mouses.set(p.id, { ...p, t: Date.now() }); avisarMouse(); });
  ch.on("presence", { event: "sync" }, () => { const st = ch.presenceState(), vivos = new Set(Object.keys(st)); for (const k of [...mouses.keys()]) if (!vivos.has(String(k))) mouses.delete(k); avisarGente(); avisarMouse(); pintarCarets(); });
  doc.on("update", (u, origen) => {
    if (origen === "remoto" || origen === "carga") return;
    ch.send({ type: "broadcast", event: "u", payload: { u: aB64(u) } });
    pend.push(u); clearTimeout(tFlush); tFlush = setTimeout(flush, 500);
  });
  /* avisar a la web cuando alguien cambió piezas, hilos o dibujos */
  let tCambio = null;
  const avisarCambio = tr => { if (tr.origin === "local") return; clearTimeout(tCambio); tCambio = setTimeout(() => { const f = foto(); for (const fn of fnsCambio) fn(f); }, 30); };
  for (const k of [...LISTAS, "campos"]) doc.getMap(k).observe((ev) => avisarCambio(ev.transaction));

  const foto = () => { const mc = doc.getMap("campos"), f = { texto: yt.toString() }; for (const k of SUELTOS) if (mc.has(k)) f[k] = mc.get(k); for (const k of LISTAS) f[k] = leerLista(doc, k); return f; };

  /* quién está */
  const otros = () => { const st = ch.presenceState(), out = []; for (const k in st) { if (k === String(yo)) continue; const v = st[k][st[k].length - 1]; if (v) out.push({ id: k, ...v }); } return out; };
  const avisarGente = () => { const l = otros().map(o => ({ nombre: o.n, color: o.c })); for (const fn of fnsGente) fn(l); };
  const avisarMouse = () => { const ahora = Date.now(), l = [...mouses.values()].filter(m => ahora - m.t < 8000); for (const fn of fnsMouse) fn(l); };
  setInterval(() => { if (!cerrado && mouses.size) avisarMouse(); }, 2000);

  /* el texto grande, enlazado a un textarea, con los cursores de texto de los demás */
  let ta = null, capaT = null, caretsEl = null, rel = null, onTexto = null, tCur = null, ultimo = "";
  const guardarSel = () => { if (!ta || document.activeElement !== ta) return; rel = [Y.createRelativePositionFromTypeIndex(yt, ta.selectionStart), Y.createRelativePositionFromTypeIndex(yt, ta.selectionEnd)]; };
  const alInput = () => {
    const viejo = yt.toString(), nuevo = ta.value; if (viejo === nuevo) return;
    let a = 0; while (a < viejo.length && a < nuevo.length && viejo[a] === nuevo[a]) a++;
    let z = 0; while (z < viejo.length - a && z < nuevo.length - a && viejo[viejo.length - 1 - z] === nuevo[nuevo.length - 1 - z]) z++;
    doc.transact(() => { const b = viejo.length - a - z; if (b > 0) yt.delete(a, b); const ins = nuevo.slice(a, nuevo.length - z); if (ins) yt.insert(a, ins); }, "local");
    guardarSel(); avisarCursor();
  };
  yt.observe(ev => {
    if (ev.transaction.origin === "local" || !ta) return;
    const enf = document.activeElement === ta, r = rel; ta.value = yt.toString();
    if (enf && r) { const a = Y.createAbsolutePositionFromRelativePosition(r[0], doc), b = Y.createAbsolutePositionFromRelativePosition(r[1], doc); if (a && b) ta.setSelectionRange(a.index, b.index); }
    onTexto && onTexto(ta.value, true); pintarCarets();
  });
  const enSel = () => { if (!cerrado && ta && document.activeElement === ta) { guardarSel(); avisarCursor(); } };
  document.addEventListener("selectionchange", enSel);
  function avisarCursor(fuera) {
    if (cerrado) return; clearTimeout(tCur);
    tCur = setTimeout(() => {
      const c = !fuera && ta && document.activeElement === ta ? Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(yt, ta.selectionStart)) : null;
      const est = { n: miNombre, c: miColor, p: c }, s = JSON.stringify(est); if (s === ultimo) return; ultimo = s; ch.track(est);
    }, 120);
  }
  function pintarCarets() {
    const c = capaT || (ta && ta.parentElement); if (!c || !ta || !ta.isConnected) return;
    if (!caretsEl || caretsEl.parentElement !== c) { caretsEl = document.createElement("div"); caretsEl.className = "vivo-cursores"; c.append(caretsEl); }
    caretsEl.replaceChildren();
    for (const o of otros()) {
      if (!o.p) continue; let abs = null; try { abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(o.p), doc); } catch (_) { }
      if (!abs) continue; const k = coordsCaret(ta, abs.index), b = document.createElement("div"); b.className = "vivo-caret"; b.style.setProperty("--c", o.c || "#e0457b");
      b.style.left = (ta.offsetLeft + k.x - ta.scrollLeft) + "px"; b.style.top = (ta.offsetTop + k.y - ta.scrollTop) + "px"; b.style.height = k.h + "px";
      const e = document.createElement("span"); e.textContent = o.n || "Alguien"; b.append(e); caretsEl.append(b);
    }
  }
  addEventListener("resize", pintarCarets);

  /* arrancar: escuchar, cargar lo guardado y avisar que llegué */
  await new Promise((ok, mal) => { const t = setTimeout(() => mal(new Error("sin conexión en vivo")), 12000); ch.subscribe(s => { if (s === "SUBSCRIBED") { clearTimeout(t); ok(); } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") { clearTimeout(t); mal(new Error(s)); } }); });
  const { data, error } = await cliente().rpc("vivo_leer", { p_id: id }); if (error) throw error;
  if (!data || !data.length) { if (!(await existe(id))) throw new Error("no existe"); }
  for (const f of data || []) { try { Y.applyUpdate(doc, deB64(f.upd), "carga"); } catch (e) { console.error(e); } }
  const titulo = data && data[0] ? data[0].titulo : "";
  if (data && data.length > 150) cliente().rpc("vivo_compactar", { p_id: id, p_estado: aB64(Y.encodeStateAsUpdate(doc)), p_hasta: data[data.length - 1].seq });
  ch.send({ type: "broadcast", event: "hola", payload: {} });
  ch.track({ n: miNombre, c: miColor, p: null });
  addEventListener("pagehide", () => { if (pend.length) flush(); });

  let tMouse = 0, mPend = null;
  return {
    id, titulo, foto, color: () => miColor,
    vacio: () => doc.getMap("bloques").size === 0 && doc.getMap("hilos").size === 0 && doc.getMap("trazos").size === 0 && !doc.getMap("campos").size,
    /* la web avisa un cambio propio en un campo (bloques, hilos, trazos, tipo…) */
    poner(campo, valor) { if (cerrado) return; doc.transact(() => { if (LISTAS.includes(campo)) ponerLista(doc, campo, valor || []); else if (SUELTOS.includes(campo)) { const mc = doc.getMap("campos"); if (JSON.stringify(mc.get(campo)) !== JSON.stringify(valor)) mc.set(campo, valor); } }, "local"); },
    ponerTodo(campos) { doc.transact(() => escribirCampos(doc, campos), "local"); },
    onCambio(fn) { fnsCambio.add(fn); return () => fnsCambio.delete(fn); },
    onGente(fn) { fnsGente.add(fn); fn(otros().map(o => ({ nombre: o.n, color: o.c }))); return () => fnsGente.delete(fn); },
    onMouse(fn) { fnsMouse.add(fn); return () => fnsMouse.delete(fn); },
    /* posición del mouse en el tablero (coordenadas del mundo, para que coincida con zoom y movimiento) */
    mouse(x, y) {
      if (cerrado) return; mPend = { id: yo, n: miNombre, c: miColor, x: x == null ? null : Math.round(x), y: y == null ? null : Math.round(y) };
      const ahora = Date.now(); if (ahora - tMouse < 45) { clearTimeout(this._tm); this._tm = setTimeout(() => this.mouse(mPend.x, mPend.y), 50); return; }
      tMouse = ahora; ch.send({ type: "broadcast", event: "m", payload: mPend });
    },
    vincular(t, op = {}) {
      if (t !== ta) { ta = t; ta.addEventListener("input", alInput); for (const ev of ["keyup", "mouseup", "select", "focus"]) ta.addEventListener(ev, () => { guardarSel(); avisarCursor(); }); ta.addEventListener("blur", () => avisarCursor(true)); }
      capaT = op.capa || null; onTexto = op.onTexto || null; const local = ta.value; ta.value = yt.toString(); onTexto && onTexto(ta.value, ta.value !== local); pintarCarets();
    },
    ponerNombre(n) { miNombre = n || "Alguien"; miColor = colorDe(miNombre); ultimo = ""; avisarCursor(true); },
    async cerrar() { cerrado = true; clearTimeout(tCur); if (pend.length) await flush(); try { await ch.untrack(); } catch (_) { } cliente().removeChannel(ch); if (caretsEl) caretsEl.remove(); removeEventListener("resize", pintarCarets); document.removeEventListener("selectionchange", enSel); }
  };
}
