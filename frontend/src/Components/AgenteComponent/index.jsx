import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Chat from './chat';
import { enviarMensajeAlBackend, enviarMensajeBalneario, getSesionContext } from './api';
import './AgenteComponent.css';

export default function App() {
  const location = useLocation();
  const storageKey = (() => {
    try {
      const user = getSesionContext();
      const uid = user?.auth_id || 'anon';
      return `chatMensajes:${uid}`;
    } catch { return 'chatMensajes:anon'; }
  })();
  const initialMensajes = (() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch {}
    return [{
      rol: 'asistente',
      texto: '¡Hola! Decime la ciudad a la que querés ir y, si querés, las fechas. Después te muestro los balnearios y te paso el link listo.'
    }];
  })();
  const [mensajes, setMensajes] = useState(initialMensajes);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { try { inputRef.current && inputRef.current.focus(); } catch {} }, []);
  const session = getSesionContext();
  const navigate = useNavigate();

  const rol = !session?.isLoggedIn ? 'invitado' : (session?.esPropietario ? 'dueno' : 'cliente');

  const handleSend = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!input.trim()) return;
    const mensajeParaEnviar = input;

    const nextUser = [...mensajes, { rol: 'user', texto: mensajeParaEnviar }];
    setMensajes(nextUser);
    try { localStorage.setItem(storageKey, JSON.stringify(nextUser)); } catch {}
    setLoading(true);
    setError('');
    setInput('');
    try {
      // Detectar si estamos en una ruta de balneario; si faltan fechas, usar defaults (hoy/mañana)
      const pathname = location.pathname || '';
      const isBalneario = /^\/balneario\/(\d+)/.test(pathname);
      let respuesta;
      if (isBalneario) {
        const match = pathname.match(/^\/balneario\/(\d+)/);
        const balnearioId = match ? Number(match[1]) : null;
        const sp = new URLSearchParams(location.search || '');
        let fi = sp.get('fi');
        let ff = sp.get('ff');
        if (!fi || !ff) {
          const today = new Date();
          const tomorrow = new Date();
          tomorrow.setDate(today.getDate() + 1);
          fi = today.toISOString().split('T')[0];
          ff = tomorrow.toISOString().split('T')[0];
        }
        if (balnearioId) {
          respuesta = await enviarMensajeBalneario({ mensaje: mensajeParaEnviar, balnearioId, fi, ff });
        } else {
          respuesta = await enviarMensajeAlBackend(mensajeParaEnviar);
        }
      } else {
        respuesta = await enviarMensajeAlBackend(mensajeParaEnviar);
      }
      const textoPlano = typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta);
      setMensajes(ms => {
        const nx = [...ms, { rol: 'asistente', texto: textoPlano }];
        try { localStorage.setItem(storageKey, JSON.stringify(nx)); } catch {}
        return nx;
      });

      // Auto-navegar SOLO si la PRIMERA línea es un link interno final
      try {
        const lines = textoPlano.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const first = lines[0] || '';
        const isFinalLink = /^\/balneario\/[\w\-]+(\?[\w\-\/.?#=&%]+)?$/.test(first);
        if (isFinalLink) {
          navigate(first);
        }
      } catch {}
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      try { inputRef.current && inputRef.current.focus(); } catch {}
    }
  };

  return (
    <div className="main-chat-bg">
      <div className="chat-box">
        <h1 className="chat-title">Asistente Praiar</h1>
        {/* Sugerencias removidas para una conversación más natural */}
        <Chat mensajes={mensajes} loading={loading} />
        <form className="chat-form" onSubmit={handleSend}>
          <input
            type="text"
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Contame qué necesitás (ej: 'quiero una carpa del 5 al 10 en Miramar')"
            ref={inputRef}
          />
          <button className="chat-send" disabled={loading}>
            Enviar
          </button>
        </form>
        {error && <div className="chat-error">{error}</div>}
        {/* Persistencia: no borramos historial salvo logout. Si se cierra sesión, limpiar storage */}
      </div>
    </div>
  );
}