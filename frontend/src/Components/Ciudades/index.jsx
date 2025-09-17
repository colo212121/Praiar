import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom'; 
import { supabase } from '../../supabaseClient.js';
import Logo from '../../assets/mar-del-plata.png';
import './Ciudades.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

function Ciudades() {
  const [ciudades, setCiudades] = useState([]);
  const [ciudadConMapa, setCiudadConMapa] = useState(null);
  const [paginaActual, setPaginaActual] = useState(1);
  const ciudadesPorPagina = 9;

  const location = useLocation();
  const isPaginaCiudades = location.pathname === "/ciudades";

  useEffect(() => {
    async function fetchCiudadesConBalnearios() {
      try {
        const res = await fetch('http://localhost:3000/api/ciudades');
        const data = await res.json();
        const ciudadesAMostrar = isPaginaCiudades ? data : data.slice(0, 8);
        setCiudades(ciudadesAMostrar);
      } catch (error) {
        console.error('Error al obtener ciudades:', error);
      }
    }

    fetchCiudadesConBalnearios();
  }, [isPaginaCiudades]);

  const abrirMapa = (nombreCiudad) => setCiudadConMapa(nombreCiudad);
  const cerrarMapa = () => setCiudadConMapa(null);

  // Paginación: obtener ciudades actuales
  const indiceUltimaCiudad = paginaActual * ciudadesPorPagina;
  const indicePrimeraCiudad = indiceUltimaCiudad - ciudadesPorPagina;
  const ciudadesPaginadas = isPaginaCiudades
    ? ciudades.slice(indicePrimeraCiudad, indiceUltimaCiudad)
    : ciudades;

  const totalPaginas = Math.ceil(ciudades.length / ciudadesPorPagina);

  const siguientePagina = () => {
    if (paginaActual < totalPaginas) setPaginaActual(paginaActual + 1);
  };

  const paginaAnterior = () => {
    if (paginaActual > 1) setPaginaActual(paginaActual - 1);
  };

  return (
    <div className="ciudades-container">
      <h2 className={isPaginaCiudades ? 'titulo-ciudades' : ''}>Ciudades</h2>
      <div className="card-grid">
        {ciudadesPaginadas.map((ciudad) => (
          <div key={ciudad.id_ciudad} className={`ciudad-card ${isPaginaCiudades ? 'card-detalle' : ''}`}>
            <img src={ciudad.img} alt={ciudad.nombre} className={`imgCiudad ${isPaginaCiudades ? 'imgCiudades-margin' : ''}`} />

            {isPaginaCiudades ? (
              <div className="detalle-card">
                <div className="info-contenido">
                  <div className="info-izquierda">
                    <h3>{ciudad.nombre}</h3>
                    <p className="mapa" onClick={() => abrirMapa(ciudad.nombre)} style={{ cursor: 'pointer' }}>
                      <FontAwesomeIcon icon="fa-solid fa-location-dot" alt="mapa" className="iconoCard"/>
                      Ver Mapa
                    </p>
                    <p className="estrella">
                      <FontAwesomeIcon icon="fa-solid fa-tent" alt="balnearios" className="iconoCard"/>
                      {ciudad.cantidadBalnearios} Balnearios
                    </p>
                  </div>
                  <Link to={`/ciudades/${ciudad.id_ciudad}/balnearios`}>
                    <button className="mirar-btn">Mirar<br />Balnearios</button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="card-content">
                <h3>{ciudad.nombre}</h3>
                <p>{ciudad.cantidadBalnearios} balnearios</p>
                <Link to={`/ciudades/${ciudad.id_ciudad}/balnearios`}>
                  <button>Ver balnearios</button>
                </Link>
              </div>
            )}
          </div>
        ))}

        {!isPaginaCiudades && (
          <div className="ciudad-card ver-mas-card">
            <Link to="/ciudades" className="ver-mas-circular" aria-label="Ver más ciudades">
              <span className="flecha-circular">➜</span>
            </Link>
          </div>
        )}
      </div>

      {/* Botones de paginación */}
      {isPaginaCiudades && ciudades.length > ciudadesPorPagina && (
        <div className="paginacion">
          <button onClick={paginaAnterior} disabled={paginaActual === 1}>
            ◀
          </button>
          <span>Página {paginaActual} de {totalPaginas}</span>
          <button onClick={siguientePagina} disabled={paginaActual === totalPaginas}>
            ▶
          </button>
        </div>
      )}

      {/* Modal de Mapa */}
      {ciudadConMapa && (
        <div className="modal-mapa-overlay">
          <div className="modal-mapa-contenido">
            <button className="cerrar-mapa-btn" onClick={cerrarMapa}>✕</button>
            <h3>{ciudadConMapa}</h3>
            <iframe
              title={`Mapa de ${ciudadConMapa}`}
              width="100%"
              height="400"
              style={{ border: 0, borderRadius: '12px' }}
              loading="lazy"
              allowFullScreen
              src={`https://www.google.com/maps?q=${encodeURIComponent(ciudadConMapa)}&output=embed`}
            ></iframe>
          </div>
        </div>
      )}
    </div>
  );
}

export default Ciudades;
