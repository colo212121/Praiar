import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Chat from './chat';
import { enviarMensajeAlBackend, getSesionContext } from './api';
import './AgenteComponent.css';

export default function App() {
  const [mensajes, setMensajes] = useState([
    {
      rol: 'asistente',
      texto: '¡Hola! Decime la ciudad a la que querés ir y, si querés, las fechas. Después te muestro los balnearios y te paso el link listo.'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const session = getSesionContext();
  const navigate = useNavigate();

  const rol = !session?.isLoggedIn ? 'invitado' : (session?.esPropietario ? 'dueno' : 'cliente');

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const mensajeParaEnviar = input;

    setMensajes([...mensajes, { rol: 'user', texto: mensajeParaEnviar }]);
    setLoading(true);
    setError('');
    setInput('');
    try {
      const respuesta = await enviarMensajeAlBackend(mensajeParaEnviar);
      const textoPlano = typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta);
      setMensajes(ms => [...ms, { rol: 'asistente', texto: textoPlano }]);

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
            disabled={loading}
          />
          <button className="chat-send" disabled={loading}>
            Enviar
          </button>
        </form>
        {error && <div className="chat-error">{error}</div>}
      </div>
    </div>
  );
}