import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Chat from './chat';
import { enviarMensajeAlBackend, getSesionContext } from './api';
import './AgenteComponent.css';

export default function App() {
  const [mensajes, setMensajes] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const session = getSesionContext();
  const navigate = useNavigate();

  const rol = !session?.isLoggedIn ? 'invitado' : (session?.esPropietario ? 'dueno' : 'cliente');

  const sugerencias = {
    invitado: [
      'Quiero ver balnearios populares',
      'Mostrar ciudades con más opciones',
      '¿Cómo reservo una carpa?'
    ],
    cliente: [
      'Buscar disponibilidad este fin de semana en Mar del Plata',
      'Filtrar balnearios con Wi-Fi y pileta',
      'Ver mapa de ciudades /ciudades'
    ],
    dueno: [
      'Ver mis balnearios /tusbalnearios',
      'Crear un nuevo balneario',
      'Ver reservas de la última semana'
    ]
  };

  const accionesRapidas = [
    'Cambiar ciudad',
    'Cambiar fechas',
    'Reiniciar'
  ];

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

      // Auto-navegar si hay exactamente una ruta interna en la respuesta
      try {
        const routeMatches = (textoPlano.match(/\/[\w\-\/.?#=&%]+/g) || []).filter(r => !/^https?:\/\//i.test(r));
        const uniqueRoutes = Array.from(new Set(routeMatches));
        if (uniqueRoutes.length === 1) {
          const route = uniqueRoutes[0];
          if (route.startsWith('/')) {
            // Usar navigate para rutas internas
            navigate(route);
          }
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
        <div className="chat-sugerencias">
          {sugerencias[rol].map((txt, i) => (
            <button
              key={i}
              type="button"
              className="chip"
              onClick={() => setInput(txt)}
              disabled={loading}
            >
              {txt}
            </button>
          ))}
          {accionesRapidas.map((txt, i) => (
            <button
              key={`a-${i}`}
              type="button"
              className="chip sec"
              onClick={() => {
                if (txt === 'Cambiar ciudad') setInput('Cambiar ciudad');
                else if (txt === 'Cambiar fechas') setInput('Me equivoqué de fecha');
                else setInput('Reiniciar');
              }}
              disabled={loading}
            >
              {txt}
            </button>
          ))}
        </div>
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