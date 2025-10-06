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

export async function enviarMensajeAlBackend(mensaje) {
  const session = getSesionContext();
  if (!chatId) {
    chatId = Math.random().toString(36).slice(2);
  }
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