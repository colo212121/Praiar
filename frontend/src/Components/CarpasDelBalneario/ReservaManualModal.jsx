import React, { useState, useEffect } from "react";

function ReservaManualModal({ mostrar, setMostrar, carpa, fechaInicio, fechaFin, onReservar }) {
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [fecha_inicio, setFechaInicio] = useState(fechaInicio || "");
  const [fecha_salida, setFechaSalida] = useState(fechaFin || "");
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mostrar) {
      setNombre("");
      setApellido("");
      setEmail("");
      setTelefono("");
      setFechaInicio(fechaInicio || "");
      setFechaSalida(fechaFin || "");
      setError(null);
      setExito(null);
    }
  }, [mostrar, fechaInicio, fechaFin, carpa]);

  if (!mostrar) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setExito(null);

    if (!nombre.trim() || !apellido.trim() || !email.trim() || !telefono.trim()) {
      setError("Todos los campos marcados con * son obligatorios.");
      return;
    }
    if (!fecha_inicio || !fecha_salida) {
      setError("Debes seleccionar una fecha de inicio y una de salida.");
      return;
    }
    if (fecha_inicio >= fecha_salida) {
      setError("La fecha de inicio debe ser anterior a la fecha de salida.");
      return;
    }

    setLoading(true);

    const datos = {
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      email: email.trim(),
      telefono: telefono.trim(),
      fecha_inicio,
      fecha_salida,
    };
    try {
      await onReservar(datos, () => {
        setLoading(false);
        setExito("Reserva realizada con éxito.");
        setTimeout(() => {
          setMostrar(false);
          setExito(null);
        }, 1300);
      });
    } catch (err) {
      setLoading(false);
      setError("Error al guardar la reserva.");
    }
  }

  return (
    <>
      <style>{`
        .modal {
          position: fixed;
          top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0,0,0,0.35);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: #fff; border-radius: 12px; padding: 32px 24px 24px 24px;
          min-width: 320px; 
          max-width: 600px;
          width: 90%;
          margin: 0 auto;
          box-shadow: 0 2px 16px rgba(0,0,0,0.18);
          position: relative;
          box-sizing: border-box;
        }
        .cerrar-mapa-btn {
          position: absolute; right: 16px; top: 12px; font-size: 22px;
          background: none; border: none; cursor: pointer; color: #333;
        }
        .reserva-form label {
          display: block;
          margin-bottom: 12px;
        }
        .reserva-form {
          border: none;
        }
        .reserva-form input, .reserva-form select {
          width: 100%;
          padding: 7px 6px;
          margin-top: 3px;
          border: 1px solid #c5c5c5;
          border-radius: 5px;
          font-size: 15px;
          box-sizing: border-box;
        }
        
        @media (max-width: 768px) {
          .modal-content {
            width: 95%;
            padding: 24px 18px 18px 18px;
          }
        }
        .form-group {
          display: flex;
          gap: 12px;
        }
        .form-group label {
          flex: 1;
        }
        .modal-buttons {
          margin-top: 18px; display: flex; gap: 12px; justify-content: flex-end;
        }
        .boton-agregar-servicio {
          background: #0c5db5;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 8px 18px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: background .2s;
        }
        .boton-agregar-servicio[disabled] {
          background: #6a829a;
          cursor: not-allowed;
        }
        .required-asterisk {
          color: #c33;
          font-weight: 600;
          margin-left: 2px;
        }
      `}</style>
      <div className="modal">
        <div className="modal-content">
          <button
            className="cerrar-mapa-btn"
            onClick={() => setMostrar(false)}
            aria-label="Cerrar"
            type="button"
          >
            ✕
          </button>
          <h3 style={{ marginTop: 0, marginBottom: 18 }}>
            Reserva manual de Carpa #{carpa?.posicion || carpa?.nro || carpa?.id_carpa}
          </h3>
          <form className="reserva-form" onSubmit={handleSubmit} style={{ padding: 0 }}>
            <div className="form-group">
              <label>Nombre/s<span className="required-asterisk">*</span>
                <input
                  type="text"
                  name="nombre"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  required
                />
              </label>
              <label>Apellido/s<span className="required-asterisk">*</span>
                <input
                  type="text"
                  name="apellido"
                  value={apellido}
                  onChange={e => setApellido(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="form-group">
            <label>Email<span className="required-asterisk">*</span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
            <label>Teléfono<span className="required-asterisk">*</span>
              <input
                type="tel"
                name="telefono"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                required
              />
            </label>
            </div>
            <div className="form-group">
              <label>
                Fecha inicio<span className="required-asterisk">*</span>
                <input
                  type="date"
                  name="fecha_inicio"
                  value={fecha_inicio}
                  onChange={e => setFechaInicio(e.target.value)}
                  required
                />
              </label>
              <label>
                Fecha salida<span className="required-asterisk">*</span>
                <input
                  type="date"
                  name="fecha_salida"
                  value={fecha_salida}
                  onChange={e => setFechaSalida(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="modal-buttons">
              <button
                type="submit"
                className="boton-agregar-servicio"
                style={{ minWidth: 100 }}
                disabled={loading}
              >
                {loading ? "Guardando..." : "Reservar"}
              </button>
              <button
                type="button"
                className="boton-agregar-servicio"
                style={{ minWidth: 100 }}
                onClick={() => setMostrar(false)}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
            {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
            {exito && <p style={{ color: "green", marginTop: 8 }}>{exito}</p>}
          </form>
        </div>
      </div>
    </>
  );
}

export default ReservaManualModal;