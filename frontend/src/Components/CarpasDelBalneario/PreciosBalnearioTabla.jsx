import React from "react";

function PreciosBalnearioTabla({ precios, esDuenio, abrirModalPrecio }) {
  if (!precios || precios.length === 0) return null;
  return (
    <div className="precios-balneario-tabla" style={{ marginTop: "2em", marginBottom: "2em" }}>
      <h3>Disponibilidad</h3>
      <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        {/* Tabla para desktop */}
        <table className="tabla-precios-reserva desktop-table" style={{ margin: '0 auto' }}>
        <thead>
          <tr>
            <th>Tipo de reserva</th>
            <th>Precio por día</th>
            <th>Precio por semana</th>
            <th>Precio por quincena</th>
            <th>Precio por mes</th>
            {esDuenio && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {precios.map((p) => (
            <tr key={p.id_tipo_ubicacion}>
              <td>{p.nombre}</td>
              <td>${p.dia}</td>
              <td>${p.semana}</td>
              <td>${p.quincena}</td>
              <td>${p.mes}</td>
              {esDuenio && (
                <td>
                  <button
                    className="boton-agregar-servicio"
                    onClick={() => abrirModalPrecio(p)}
                  >
                    Editar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      
      {/* Tarjetas para mobile */}
      <div className="tarjetas-precios-mobile">
        {precios.map((p) => (
          <div key={p.id_tipo_ubicacion} className="tarjeta-precio">
            <div className="tarjeta-precio-header">
              <h4>{p.nombre}</h4>
            </div>
            <div className="tarjeta-precio-body-compacto">
              <div className="precio-compacto-row">
                <span className="precio-label">Día</span>
                <span className="precio-valor">${p.dia}</span>
              </div>
              <div className="precio-compacto-row">
                <span className="precio-label">Semana</span>
                <span className="precio-valor">${p.semana}</span>
              </div>
              <div className="precio-compacto-row">
                <span className="precio-label">Quincena</span>
                <span className="precio-valor">${p.quincena}</span>
              </div>
              <div className="precio-compacto-row">
                <span className="precio-label">Mes</span>
                <span className="precio-valor">${p.mes}</span>
              </div>
              {esDuenio && (
                <button
                  className="boton-agregar-servicio"
                  onClick={() => abrirModalPrecio(p)}
                  style={{ marginTop: '0.5rem', width: '100%' }}
                >
                  Editar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreciosBalnearioTabla;