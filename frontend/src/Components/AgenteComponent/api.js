function getSesionContext() {
  try {
    const raw = localStorage.getItem('usuario');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return {
      isLoggedIn: true,
      auth_id: user?.auth_id || user?.id || null,
      esPropietario: !!user?.esPropietario,
      nombre: user?.nombre || null,
      apellido: user?.apellido || null,
      email: user?.email || null,
    };
  } catch {
    return null;
  }
}

let chatId = null;
function getUserScopedKey(base) {
  try {
    const user = getSesionContext();
    const uid = user?.auth_id || 'anon';
    return `${base}:${uid}`;
  } catch { return base; }
}
function loadChatId(keyBase) {
  const key = getUserScopedKey(keyBase);
  const val = localStorage.getItem(key);
  return val || null;
}
function saveChatId(keyBase, value) {
  const key = getUserScopedKey(keyBase);
  try { localStorage.setItem(key, value); } catch {}
}

export async function enviarMensajeAlBackend(mensaje) {
  const session = getSesionContext();
  if (!chatId) chatId = loadChatId('chatId') || Math.random().toString(36).slice(2);
  saveChatId('chatId', chatId);
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: mensaje, session, chatId }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Error al comunicar con el backend');
  }
  const data = await res.json();
  // Maneja ambos casos: string o objeto con .data
  if (typeof data.response === "string") {
    return data.response;
  }
  if (data.response && typeof data.response.data === "string") {
    return data.response.data;
  }
  // Si no es ninguno, devuelve el objeto en string (debug)
  return JSON.stringify(data.response);
}

// Export util para que el frontend pueda mostrar sugerencias según rol
export { getSesionContext };

// Nuevo: chat en página de balneario con contexto (balnearioId + fechas)
let balnearioChatId = null;
export async function enviarMensajeBalneario({ mensaje, balnearioId, fi, ff }) {
  const session = getSesionContext();
  if (!balnearioChatId) balnearioChatId = loadChatId('balnearioChatId') || Math.random().toString(36).slice(2);
  saveChatId('balnearioChatId', balnearioChatId);
  const res = await fetch('http://localhost:3000/api/chat-balneario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: mensaje,
      session,
      chatId: balnearioChatId,
      context: { balnearioId, fi, ff }
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Error al comunicar con el backend');
  }
  const data = await res.json();
  if (typeof data.response === 'string') return data.response;
  return JSON.stringify(data.response);
}