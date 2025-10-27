import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation, useParams, Link } from "react-router-dom";
import "./CarpasDelBalneario.css";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faList, faCog, faSearchPlus, faSearchMinus, faExpandArrowsAlt, faMapMarkerAlt, faChevronRight, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { DateRange } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import BusquedaHomeSearch from "../../assets/BusquedaHome.png";

import ElementoAutocomplete from "./ElementoAutocomplete";
import CarpaItem from "./CarpaItem";
import ElementoItem from "./ElementoItem";
import ServiciosSection from "./ServiciosSection";
import ReseniasSection from "./ReseniasSection";
import AgregarCarpaModal from "./AgregarCarpaModal";
import EditarCarpaModal from "./EditarCarpaModal";
import PreciosBalnearioTabla from "./PreciosBalnearioTabla";
import EditarPrecioModal from "./EditarPrecioModal";
import ReservaManualModal from "./ReservaManualModal";
// Chat del agente se mantiene en su apartado original, no se renderiza aquí

const CARD_WIDTH = 340;
const RESEÑAS_POR_VISTA = 2;
const EXTEND_FACTOR = 100;

function CarpasDelBalneario(props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams();
  const balnearioId = props.id ?? location.state?.id ?? routeId;
  const today = new Date();
  const defaultInicio = today.toISOString().split('T')[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const defaultFin = tomorrow.toISOString().split('T')[0];

  // Lee fechas desde query params ?fi=YYYY-MM-DD&ff=YYYY-MM-DD
  const searchParams = new URLSearchParams(location.search || "");
  const qpFi = searchParams.get('fi');
  const qpFf = searchParams.get('ff');

  function isIsoDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  }
  function parseIsoToLocalDate(iso) {
    if (!isIsoDate(iso)) return null;
    const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d);
  }

  const initialFi = props.fechaInicio || location.state?.fechaInicio || (isIsoDate(qpFi) ? qpFi : defaultInicio);
  const initialFf = props.fechaFin || location.state?.fechaFin || (isIsoDate(qpFf) ? qpFf : defaultFin);

  // Estado para imágenes y modal de mapa
  const [imagenesBalneario, setImagenesBalneario] = useState([]);
  const [showGaleria, setShowGaleria] = useState(false);
  const [showMapa, setShowMapa] = useState(false);

  // Carrusel de galería
  const [carouselIndex, setCarouselIndex] = useState(0);

  const [rangoFechas, setRangoFechas] = useState([
    {
      startDate: parseIsoToLocalDate(initialFi) || new Date(initialFi),
      endDate: parseIsoToLocalDate(initialFf) || new Date(initialFf),
      key: "selection",
    },
  ]);
  const fechaInicio = rangoFechas[0].startDate.toISOString().split('T')[0];
  const fechaFin = rangoFechas[0].endDate.toISOString().split('T')[0];
  const [showCalendarioModal, setShowCalendarioModal] = useState(false);
  const [actualizandoDisponibilidad, setActualizandoDisponibilidad] = useState(false);
  const [rangoFechasDraft, setRangoFechasDraft] = useState(rangoFechas);
  const [seleccionadas, setSeleccionadas] = props.seleccionadas !== undefined
    ? [props.seleccionadas, props.setSeleccionadas]
    : useState([]);
  const containerRef = useRef(null);
  const modalContentRef = useRef(null);
  const [carpas, setCarpas] = useState([]);
  const [elementos, setElementos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [esDuenio, setEsDuenio] = useState(false);
  const [usuarioLogueado, setUsuarioLogueado] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [carpaEditando, setCarpaEditando] = useState(null);
  const [balnearioInfo, setBalnearioInfo] = useState(null);
  const [Ciudad, setCiudad] = useState(null);
  const [mostrarModalServicios, setMostrarModalServicios] = useState(false);
  const [todosLosServicios, setTodosLosServicios] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [tiposUbicacion, setTiposUbicacion] = useState([]);
  const [mostrarAgregarCarpa, setMostrarAgregarCarpa] = useState(false);
  const [nuevaCarpa, setNuevaCarpa] = useState({
    id_tipo_ubicacion: "",
    cant_sillas: 2,
    cant_mesas: 1,
    cant_reposeras: 2,
    capacidad: 4,
  });
  const [precios, setPrecios] = useState([]);
  const [editandoPrecio, setEditandoPrecio] = useState(null);
  const [precioEdit, setPrecioEdit] = useState({ dia: "", semana: "", quincena: "", mes: "" });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [touchStart, setTouchStart] = useState(null);
  const [todosElementos] = useState([
    { nombre: "Pasillo", tipo: "pasillo" },
    { nombre: "Pileta", tipo: "pileta" },
    { nombre: "Quincho", tipo: "quincho" }
  ]);
  const [elementoInput, setElementoInput] = useState("");
  const [elementoMatches, setElementoMatches] = useState([]);
  const elementoInputRef = useRef(null);
  const elementoDropdownRef = useRef(null);
  const [resenias, setResenias] = useState([]);
  const [loadingResenias, setLoadingResenias] = useState(false);
  const [errorResenias, setErrorResenias] = useState(null);
  const [reseniaNueva, setReseniaNueva] = useState({ comentario: "", estrellas: 5, estrellasHover: undefined });
  const [indiceResenia, setIndiceResenia] = useState(0);
  const [animating, setAnimating] = useState(false);
  const reseñasExtendidas = Array(EXTEND_FACTOR).fill(resenias).flat();
  const baseIndex = resenias.length * Math.floor(EXTEND_FACTOR / 2);
  const [mostrarReservaManual, setMostrarReservaManual] = useState(false);
  const [carpaParaReservar, setCarpaParaReservar] = useState(null);

  // Sincroniza cambios de query params con el rango de fechas del estado
  useEffect(() => {
    const fi = searchParams.get('fi');
    const ff = searchParams.get('ff');
    if (isIsoDate(fi) && isIsoDate(ff)) {
      const newStart = parseIsoToLocalDate(fi) || new Date(fi);
      const newEnd = parseIsoToLocalDate(ff) || new Date(ff);
      setRangoFechas([{ startDate: newStart, endDate: newEnd, key: 'selection' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // ============== IMÁGENES BALNEARIO ==============
  useEffect(() => {
    if (!balnearioId) return;
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/imagenes`)
      .then(res => res.json())
      .then(data => {
        setImagenesBalneario(data.imagenes || []);
      });
  }, [balnearioId]);

  // Modal galería: cerrar con ESC y manejar flechas
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setShowGaleria(false);
        setShowMapa(false);
      }
      if (showGaleria && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        if (e.key === 'ArrowRight') {
          setCarouselIndex(current => Math.min(current + 1, imagenesBalneario.length - 1));
        } else if (e.key === 'ArrowLeft') {
          setCarouselIndex(current => Math.max(current - 1, 0));
        }
      }
    }
    if (showGaleria || showMapa) {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [showGaleria, showMapa, imagenesBalneario.length]);

  // Manejar intercambio de imágenes
  const handleIntercambiarImagen = (indexOriginal) => {
    if (indexOriginal === 0) return; // Ya es la principal
    
    // Intercambiar las imágenes en el array
    const nuevasImagenes = [...imagenesBalneario];
    const temp = nuevasImagenes[0];
    nuevasImagenes[0] = nuevasImagenes[indexOriginal];
    nuevasImagenes[indexOriginal] = temp;
    setImagenesBalneario(nuevasImagenes);
  };
  
  // Extraer imagen principal y secundarias (máximo 7)
  const imagenPrincipal = imagenesBalneario[0]?.url;
  const imagenesSecundarias = imagenesBalneario
    .map((img, idx) => ({ url: img.url, idx }))
    .filter((item) => item.idx !== 0)
    .slice(0, 5);
  const imagenesExtra = imagenesBalneario.slice(7);

  function handleReservarManual(carpa) {
    setCarpaParaReservar(carpa);
    setMostrarReservaManual(true);
  }

  async function reservarManual(datosReserva, onComplete) {
    if (!balnearioId || !carpaParaReservar) return;
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    const body = {
      id_usuario: usuario?.auth_id || usuario?.id_usuario || "",
      id_ubicaciones: [carpaParaReservar.id_carpa],
      id_balneario: balnearioId,
      fecha_inicio: datosReserva.fecha_inicio,
      fecha_salida: datosReserva.fecha_salida,
      metodo_pago: "manual",
      nombre: datosReserva.nombre,
      apellido: datosReserva.apellido || "",
      email: datosReserva.email,
      telefono: datosReserva.telefono,
      direccion: "",
      ciudad: "",
      codigo_postal: "",
      pais: "",
      precio_total: 0
    };
    const res = await fetch(`http://localhost:3000/api/reserva`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/reservas?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`)
        .then(res => res.json())
        .then(data => setReservas(Array.isArray(data) ? data : []));
      onComplete();
      alert("Reserva creada con éxito");
    } else {
      const error = await res.json();
      alert(error.error || "Error al crear reserva");
      onComplete();
    }
  }

  useEffect(() => { if (resenias.length > 0) setIndiceResenia(baseIndex); }, [resenias.length]);

  useEffect(() => {
    if (!balnearioId) return;
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    if (usuario && (usuario.auth_id || usuario.id_usuario)) {
      setUsuarioLogueado(true);
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/info`)
        .then(res => res.json())
        .then(info => {
          setBalnearioInfo(info);
          setCiudad(info.ciudad || "");
          const userAuthId = usuario.auth_id;
          const userNumericId = usuario.id_usuario;
          if (
            usuario.esPropietario === true ||
            info.id_usuario === userAuthId ||
            info.id_usuario === userNumericId
          ) {
            setEsDuenio(true);
          } else {
            setEsDuenio(false);
          }
        });
    } else {
      setUsuarioLogueado(false);
    }
  }, [balnearioId]);

  useEffect(() => {
    if (!elementoInput) { setElementoMatches([]); return; }
    const normalizar = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const inputNorm = normalizar(elementoInput);
    const matches = todosElementos.filter(e =>
      normalizar(e.nombre).startsWith(inputNorm)
    );
    setElementoMatches(matches);
  }, [elementoInput, todosElementos]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (elementoDropdownRef.current && !elementoDropdownRef.current.contains(event.target)) {
        setElementoMatches([]);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function agregarElementoTipo(tipo) {
    if (!balnearioId) return;
    const res = await fetch(`http://localhost:3000/api/balneario/${balnearioId}/elemento`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo }),
    });
    const data = await res.json();
    setElementos((prev) => [...prev, data]);
    setElementoInput("");
    setElementoMatches([]);
  }

  useEffect(() => {
    if (!balnearioId) return;
    setLoading(true);
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/carpas`)
      .then(res => res.json())
      .then(data => {
        setCarpas(data.map((c, i) => ({
          ...c,
          x: c.x ?? i * 100,
          y: c.y ?? 0,
        })));
      });
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/elementos`)
      .then(res => res.json())
      .then(setElementos);
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/servicios-todos`)
      .then(res => res.json())
      .then(setTodosLosServicios);
    fetch("http://localhost:3000/api/tipos-ubicaciones")
      .then(res => res.json())
      .then(setTiposUbicacion);
    setLoading(false);
  }, [balnearioId]);

  useEffect(() => {
    if (!fechaInicio || !fechaFin || !balnearioId) return;
    setActualizandoDisponibilidad(true);
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/reservas?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`)
      .then(res => res.json())
      .then(data => setReservas(Array.isArray(data) ? data : []))
      .finally(() => setActualizandoDisponibilidad(false));
  }, [balnearioId, fechaInicio, fechaFin]);

  useEffect(() => {
    if (!balnearioId) return;
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/precios`)
      .then(res => res.json())
      .then(setPrecios);
  }, [balnearioId]);

  useEffect(() => {
    if (!balnearioId) return;
    setLoadingResenias(true);
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    let url = `http://localhost:3000/api/balneario/${balnearioId}/resenias`;
    if (usuario?.id_usuario) url += `?usuario_id=${usuario.id_usuario}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        setResenias(data.resenias || []);
        setLoadingResenias(false);
      })
      .catch(err => {
        setErrorResenias("Error cargando reseñas");
        setLoadingResenias(false);
      });
  }, [balnearioId, usuarioLogueado]);

  const getTipoCarpa = (carpa) => {
    return tiposUbicacion.find(t => t.id_tipo_ubicaciones === carpa.id_tipo_ubicacion)?.nombre || "simple";
  };

  const carpaReservada = (idUbicacion) => {
    if (!fechaInicio || !fechaFin) return false;
    const inicio = new Date(fechaInicio + 'T00:00:00');
    const fin = new Date(fechaFin + 'T00:00:00');
    return reservas.some(res => {
      if (res.id_ubicacion !== idUbicacion) return false;
      const resInicio = new Date(res.fecha_inicio + 'T00:00:00');
      const resFin = new Date(res.fecha_salida + 'T00:00:00');
      return resInicio <= fin && resFin >= inicio;
    });
  };

  async function toggleServicio(servicioId, tiene) {
    if (!balnearioId) return;
    if (tiene) {
      await fetch(`http://localhost:3000/api/balneario/${balnearioId}/servicio/${servicioId}`, {
        method: "DELETE"
      });
    } else {
      await fetch(`http://localhost:3000/api/balneario/${balnearioId}/servicio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_servicio: servicioId }),
      });
    }
    fetch(`http://localhost:3000/api/balneario/${balnearioId}/info`)
      .then(res => res.json())
      .then(info => setBalnearioInfo(prev => ({ ...prev, servicios: info.servicios })));
  }

  async function agregarResenia() {
    if (!balnearioId) return;
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    if (!usuario || !usuario.id_usuario) {
      alert("Debes iniciar sesión para dejar una reseña.");
      return;
    }
    if (!reseniaNueva.comentario.trim()) {
      alert("Por favor escribe un comentario.");
      return;
    }
    if (!reseniaNueva.estrellas || isNaN(reseniaNueva.estrellas) || reseniaNueva.estrellas < 1 || reseniaNueva.estrellas > 5) {
      alert("Selecciona una cantidad de estrellas válida.");
      return;
    }
    const body = {
      comentario: reseniaNueva.comentario,
      estrellas: Number(reseniaNueva.estrellas),
      id_usuario: usuario.id_usuario
    };
    const res = await fetch(`http://localhost:3000/api/balneario/${balnearioId}/resenias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      setReseniaNueva({ comentario: "", estrellas: 5, estrellasHover: undefined });
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/resenias`)
        .then(r => r.json())
        .then(data => setResenias(data.resenias || []));
    } else {
      alert("Error al enviar reseña");
    }
  }

  async function fetchResenias() {
    if (!balnearioId) return;
    const usuarioGuardado = JSON.parse(localStorage.getItem('usuario'));
    const usuario_id = usuarioGuardado?.id_usuario;
    let url = `http://localhost:3000/api/balneario/${balnearioId}/resenias`;
    if (usuario_id) url += `?usuario_id=${usuario_id}`;
    const res = await fetch(url);
    const data = await res.json();
    setResenias(data.resenias);
  }

  async function likeResenia(id_reseña) {
    if (!balnearioId) return;
    const usuarioGuardado = JSON.parse(localStorage.getItem('usuario'));
    const id_usuario = usuarioGuardado?.id_usuario;
    if (!id_usuario) {
      alert("Debes estar logueado para dar like.");
      return;
    }
    await fetch(`http://localhost:3000/api/resenias/${id_reseña}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_usuario })
    });
    fetchResenias();
  }

  function handleAvanzarResenias() {
    if (animating) return;
    setAnimating(true);
    setIndiceResenia(prev => prev + 1);
  }
  function handleRetrocederResenias() {
    if (animating) return;
    setAnimating(true);
    setIndiceResenia(prev => prev - 1);
  }
  function handleTransitionEnd() {
    setAnimating(false);
    if (resenias.length === 0) return;
    if (indiceResenia <= resenias.length - 1) {
      setIndiceResenia(baseIndex + (indiceResenia % resenias.length));
    } else if (indiceResenia >= reseñasExtendidas.length - RESEÑAS_POR_VISTA) {
      setIndiceResenia(baseIndex + ((indiceResenia - baseIndex) % resenias.length));
    }
  }

  function onMouseMove(e) {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = (mouseX - pan.x) / zoom - 40 - (dragging.offsetX || 0);
    const y = (mouseY - pan.y) / zoom - 40 - (dragging.offsetY || 0);

    if (dragging.tipo === "carpa") {
      setCarpas((prev) =>
        prev.map((c) =>
          c.id_carpa === dragging.id ? { ...c, x, y } : c
        )
      );
    } else if (dragging.tipo === "elemento") {
      setElementos((prev) =>
        prev.map((el) =>
          el.id_elemento === dragging.id ? { ...el, x, y } : el
        )
      );
    }
  }

  async function onMouseUp() {
    if (!dragging) return;
    try {
      if (dragging.tipo === "carpa") {
        const carpa = carpas.find((c) => c.id_carpa === dragging.id);
        if (carpa) {
          const finalX = Math.round(carpa.x);
          const finalY = Math.round(carpa.y);
          const res = await fetch(`http://localhost:3000/api/balneario/carpas/${carpa.id_carpa}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x: finalX, y: finalY }),
          });
          if (!res.ok) {
            console.warn('No se pudo guardar posición de carpa', carpa.id_carpa);
          } else {
            fetch(`http://localhost:3000/api/balneario/${balnearioId}/carpas`)
              .then(r => r.json())
              .then(data => setCarpas(data.map(c => ({ ...c }))));
          }
        }
      } else if (dragging.tipo === "elemento") {
        const el = elementos.find((el) => el.id_elemento === dragging.id);
        if (el) {
          const finalX = Math.round(el.x);
          const finalY = Math.round(el.y);
          const res = await fetch(`http://localhost:3000/api/balneario/elementos/${el.id_elemento}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x: finalX, y: finalY }),
          });
          if (!res.ok) {
            console.warn('No se pudo guardar posición de elemento', el.id_elemento);
          } else {
            fetch(`http://localhost:3000/api/balneario/${balnearioId}/elementos`)
              .then(r => r.json())
              .then(setElementos);
          }
        }
      }
    } finally {
      setDragging(null);
    }
  }

  async function eliminarCarpa(id_carpa) {
    if (!balnearioId) return;
    await fetch(`http://localhost:3000/api/balneario/carpas/${id_carpa}`, { method: "DELETE" });
    setCarpas((prev) => prev.filter((carpa) => carpa.id_carpa !== id_carpa));
  }

  function handleEditarCarpa(carpa) {
    setCarpaEditando({ ...carpa });
  }

  function handleInputChange(e) {
    const { name, value } = e.target;
    setCarpaEditando((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function guardarCambios() {
    if (!balnearioId) return;
    const { id_carpa, ...datos } = carpaEditando;
    await fetch(`http://localhost:3000/api/balneario/carpas/${id_carpa}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    setCarpas((prev) =>
      prev.map((c) => (c.id_carpa === id_carpa ? { ...c, ...datos } : c))
    );
    setCarpaEditando(null);
  }

  function rotarElemento(id_elemento) {
    setElementos((prev) =>
      prev.map((el) =>
        el.id_elemento === id_elemento
          ? { ...el, rotado: (el.rotado || 0) + 90 }
          : el
      )
    );
    const el = elementos.find((e) => e.id_elemento === id_elemento);
    if (el) {
      fetch(`http://localhost:3000/api/balneario/elementos/${id_elemento}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotado: (el.rotado || 0) + 90 }),
      });
    }
  }

  async function handleAgregarCarpa() {
    if (!balnearioId) return;
    const usuario = JSON.parse(localStorage.getItem("usuario"));
    if (!nuevaCarpa.id_tipo_ubicacion) return alert("Seleccione el tipo");
    const STEP_X = 100;
    const STEP_Y = 100;
    const MAX_X = 10;
    const MAX_Y = 10;
    const ocupadas = new Set();
    carpas.forEach(c => {
      const x = Number.isFinite(c.x) ? c.x : 0;
      const y = Number.isFinite(c.y) ? c.y : 0;
      ocupadas.add(`${x},${y}`);
    });
    elementos.forEach(e => {
      const x = Number.isFinite(e.x) ? e.x : 0;
      const y = Number.isFinite(e.y) ? e.y : 0;
      ocupadas.add(`${x},${y}`);
    });
    let libreX = null, libreY = null;
    outer: for (let y = 0; y < MAX_Y; y++) {
      for (let x = 0; x < MAX_X; x++) {
        const key = `${x * STEP_X},${y * STEP_Y}`;
        if (!ocupadas.has(key)) {
          libreX = x * STEP_X;
          libreY = y * STEP_Y;
          break outer;
        }
      }
    }
    if (libreX === null || libreY === null) {
      alert("No hay espacio libre para agregar una nueva carpa/sombrilla.");
      return;
    }
    const res = await fetch(`http://localhost:3000/api/balneario/${balnearioId}/carpas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...nuevaCarpa,
        id_usuario: usuario.auth_id,
        x: libreX,
        y: libreY
      })
    });
    if (res.ok) {
      setMostrarAgregarCarpa(false);
      setNuevaCarpa({
        id_tipo_ubicacion: "",
        cant_sillas: 2,
        cant_mesas: 1,
        cant_reposeras: 2,
        capacidad: 4,
      });
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/carpas`)
        .then(res => res.json())
        .then(data => {
          setCarpas(data.map((c, i) => ({
            ...c,
            x: Number.isFinite(c.x) ? c.x : i * STEP_X,
            y: Number.isFinite(c.y) ? c.y : 0,
          })));
        });
    } else {
      alert("Hubo un error al agregar la carpa/sombrilla");
    }
  }

  async function onAgregarPrecio(precioNuevo) {
    if (!balnearioId) return alert("Falta id de balneario");
    const res = await fetch(`http://localhost:3000/api/balneario/${balnearioId}/precios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...precioNuevo,
        id_balneario: balnearioId
      })
    });
    if (res.ok) {
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/precios`)
        .then(res => res.json())
        .then(setPrecios);
    } else {
      alert("Error al agregar precio.");
    }
  }

  function abrirModalPrecio(p) {
    setEditandoPrecio(p);
    setPrecioEdit({
      dia: p.dia,
      semana: p.semana,
      quincena: p.quincena,
      mes: p.mes,
    });
  }

  async function guardarPrecio() {
    if (!balnearioId) return;
    const p = editandoPrecio;
    const res = await fetch(
      `http://localhost:3000/api/balneario/${balnearioId}/precios/${p.id_tipo_ubicacion}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(precioEdit),
      }
    );
    if (res.ok) {
      fetch(`http://localhost:3000/api/balneario/${balnearioId}/precios`)
        .then(res => res.json())
        .then(setPrecios);
      setEditandoPrecio(null);
    } else {
      alert("Error al guardar precio.");
    }
  }

  const handleZoomIn = () => { setZoom(prevZoom => Math.min(prevZoom * 1.2, 3)); };
  const handleZoomOut = () => { setZoom(prevZoom => Math.max(prevZoom / 1.2, 0.3)); };
  const handleResetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  
  // Handlers para que TODOS puedan arrastrar el mapa para navegarlo
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (target.closest && (target.closest('.carpa') || target.closest('.elemento'))) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y
    });
  };
  
  const handleMouseMove = (e) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
    if (dragging) {
      onMouseMove(e);
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
    if (dragging) {
      onMouseUp();
    }
  };

  // Touch handlers para móviles
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    setTouchStart({
      x: touch.clientX - pan.x,
      y: touch.clientY - pan.y
    });
    setDragStart({
      x: touch.clientX - pan.x,
      y: touch.clientY - pan.y
    });
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1 || !touchStart) return;
    e.preventDefault();
    const touch = e.touches[0];
    setPan({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isDragging) setIsDragging(false);
      if (dragging) onMouseUp();
    };
    const handleWindowMouseMove = (e) => {
      if (isDragging || dragging) handleMouseMove(e);
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('mousemove', handleWindowMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('mousemove', handleWindowMouseMove);
    };
  }, [isDragging, dragging, dragStart, pan, zoom]);

  const handleWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(3, zoom * delta));
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomRatio = newZoom / zoom;
    setPan(prevPan => ({
      x: mouseX - (mouseX - prevPan.x) * zoomRatio,
      y: mouseY - (mouseY - prevPan.y) * zoomRatio
    }));
    setZoom(newZoom);
  };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setShowCalendarioModal(false);
        setShowMapa(false);
      }
    }
    if (showCalendarioModal || showMapa) {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [showCalendarioModal, showMapa]);

  if (loading) return <p>Cargando carpas...</p>;
  if (error) return <p>{error}</p>;


  return (
    <div className="carpas-del-balneario">
      {/* ===================== HEADER CON IMÁGENES ===================== */}
      <div className="balneario-header-imgs">
        <h1 className="balneario-nombre-mapa">{balnearioInfo?.nombre || 'Balneario'}</h1>
        <div className="balneario-direccion-row">
          <FontAwesomeIcon icon={faMapMarkerAlt} className="direccion-icon" />
          <span>{balnearioInfo?.direccion || '-'}</span>
          {Ciudad && <span>, {Ciudad}</span>}
          {balnearioInfo?.direccion && (
            <span
              className="map-link"
              style={{ cursor: 'pointer', color: '#0076c9', textDecoration: 'underline', marginLeft: 8 }}
              onClick={() => setShowMapa(true)}
            >
              Ver mapa
            </span>
          )}
        </div>
        {/* Galería de imágenes */}
        <div className="balneario-imagenes-grid">
          <div className="principal-img-wrapper">
            {imagenPrincipal && (
              <img 
                src={imagenPrincipal} 
                alt="Principal balneario" 
                className="img-principal"
                onClick={() => setShowGaleria(true)}
                style={{ cursor: 'pointer' }}
              />
            )}
          </div>
          <div className="secundarias-img-wrapper">
            {imagenesSecundarias.map((item, idx) => (
              <img 
                key={idx} 
                src={item.url} 
                alt={`Foto ${idx + 2} balneario`} 
                className="img-secundaria"
                onClick={() => handleIntercambiarImagen(item.idx)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            {imagenesExtra.length > 0 && (
              <div className="img-mas-fotos" onClick={() => { setShowGaleria(true); setCarouselIndex(0); }}>
                <span>{imagenesBalneario.length} fotos más</span>
                <FontAwesomeIcon icon={faChevronRight} />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Modal galería - solo mostrar la imagen principal */}
      {showGaleria && (
        <div className="modal-galeria" onClick={() => setShowGaleria(false)}>
          <div className="modal-galeria-content" onClick={e => e.stopPropagation()}>
            <button className="close-galeria-btn" onClick={() => setShowGaleria(false)}>✕</button>
            {imagenPrincipal && (
              <img
                src={imagenPrincipal}
                alt="Imagen del balneario"
                className="img-galeria-carrusel"
              />
            )}
          </div>
        </div>
      )}
      {/* Modal Mapa tipo Ciudades */}
      {showMapa && (
        <div className="modal-mapa-overlay" onClick={() => setShowMapa(false)}>
          <div className="modal-mapa-contenido" onClick={e => e.stopPropagation()}>
            <button className="cerrar-mapa-btn" onClick={() => setShowMapa(false)}>✕</button>
            <h3>{balnearioInfo?.nombre}</h3>
            <iframe
              title={`Mapa de ${balnearioInfo?.nombre}`}
              width="100%"
              height="400"
              style={{ border: 0, borderRadius: '12px' }}
              loading="lazy"
              allowFullScreen
              src={`https://www.google.com/maps?q=${encodeURIComponent(balnearioInfo?.direccion || balnearioInfo?.nombre || '')}&output=embed`}
            ></iframe>
          </div>
        </div>
      )}
      {/* ================ PANEL IZQUIERDO Y MAPA ================= */}
      <div className="main-content-layout">
        <div className="management-panel">
          <div className="system-status">
            <div className="status-indicator active"></div>
            {esDuenio ? (
              <span className="status-text">Tu panel de control</span>
            ) : (
              <span className="status-text">Edita la fecha!</span>
            )}
          </div>
          {esDuenio ? (
            <>
              <div className="panel-section">
                <h3 className="panel-title">Gestión de Fechas</h3>
                <div className="availability-row">
                  <div className="availability-info">
                    <p>
                      Mostrando disponibilidad del {new Date(fechaInicio + 'T00:00:00').toLocaleDateString('es-ES')} al {new Date(fechaFin + 'T00:00:00').toLocaleDateString('es-ES')}
                    </p>
                  </div>
                  <div className="availability-actions">
                    <button
                      className="cambiar-fecha-btn"
                      onClick={() => {
                        setShowCalendarioModal(true);
                        setRangoFechasDraft(rangoFechas);
                      }}
                      disabled={actualizandoDisponibilidad}
                    >
                      Cambiar Fecha
                    </button>
                  </div>
                </div>
              </div>
              <div className="panel-section">
                <h3 className="panel-title">Gestión de Elementos</h3>
                <div className="add-elements-container">
                  <div className="element-input-group">
                    <label className="subtitulo">Tipo de elemento</label>
                    <ElementoAutocomplete
                      elementoInput={elementoInput}
                      setElementoInput={setElementoInput}
                      elementoMatches={elementoMatches}
                      setElementoMatches={setElementoMatches}
                      agregarElementoTipo={agregarElementoTipo}
                      elementoInputRef={elementoInputRef}
                      elementoDropdownRef={elementoDropdownRef}
                    />
                  </div>
                  <button className="panel-button primary" onClick={() => setMostrarAgregarCarpa(true)}>
                    <FontAwesomeIcon icon={faPlus} /> Agregar Carpa/Sombrilla
                  </button>
                </div>
              </div>
              <div className="panel-section">
                <h3 className="panel-title">Acciones del Sistema</h3>
                <div className="quick-actions">
                  <Link className="panel-button secondary" to={`/tusreservas/${balnearioInfo?.id_balneario}`}>
                    <FontAwesomeIcon icon={faList} /> Ver Reservas
                  </Link>
                  <button className="panel-button secondary" onClick={() => setMostrarModalServicios(true)}>
                    <FontAwesomeIcon icon={faCog} /> Gestionar Servicios
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="panel-section">
              <h3 className="panel-title">Información de Disponibilidad</h3>
              <div className="availability-row">
                <div className="availability-info">
                  <p>
                    Mostrando disponibilidad del {new Date(fechaInicio + 'T00:00:00').toLocaleDateString('es-ES')} al {new Date(fechaFin + 'T00:00:00').toLocaleDateString('es-ES')}
                  </p>
                </div>
                <div className="availability-actions">
                  <button
                    className="cambiar-fecha-btn"
                    onClick={() => {
                      setShowCalendarioModal(true);
                      setRangoFechasDraft(rangoFechas);
                    }}
                    disabled={actualizandoDisponibilidad}
                  >
                    Cambiar Fecha
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="map-container-wrapper">
          {actualizandoDisponibilidad && (
            <div className="map-loading-overlay">
              <div className="spinner" />
              <span>Actualizando disponibilidad…</span>
            </div>
          )}
          <div className="map-legend">
            <div className="legend-item"><span className="legend-dot libre" /> Disponible</div>
            <div className="legend-item"><span className="legend-dot reservada" /> Reservado</div>
          </div>
          <div className="zoom-controls">
            <div className="zoom-level-indicator">{Math.round(zoom * 100)}%</div>
            <button className="zoom-btn zoom-in" onClick={handleZoomIn}>+</button>
            <button className="zoom-btn zoom-out" onClick={handleZoomOut}>-</button>
            <button className="zoom-btn zoom-reset" onClick={handleResetZoom}>
              <FontAwesomeIcon icon={faRotateLeft} />
            </button>
          </div>
          <div
            className="carpa-container"
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ 
              cursor: isDragging ? 'grabbing' : 'grab'
            }}
          >
            <div
              className="map-canvas"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0'
              }}
            >
            {carpas.map((carpa) => {
              const tipo = getTipoCarpa(carpa);
              const left = carpa.x;
              const top = carpa.y;
              return (
                <div
                  key={carpa.id_carpa}
                  className="carpa-wrapper"
                  style={{ position: "absolute", left, top, zIndex: 1, pointerEvents: 'auto' }}
                >
                  <CarpaItem
                    carpa={carpa}
                    tipo={tipo}
                    left={0}
                    top={0}
                    esDuenio={esDuenio}
                    dragging={dragging}
                    setDragging={setDragging}
                    carpaReservada={carpaReservada}
                    usuarioLogueado={usuarioLogueado}
                    navigate={navigate}
                    eliminarCarpa={eliminarCarpa}
                    handleEditarCarpa={handleEditarCarpa}
                    fechaInicio={fechaInicio}
                    fechaFin={fechaFin}
                    idBalneario={balnearioId}
                    seleccionadas={seleccionadas}
                    setSeleccionadas={setSeleccionadas}
                    soloSeleccion={props.soloSeleccion}
                    reservaSeleccionMultiple={props.reservaSeleccionMultiple}
                    onReservarManual={esDuenio ? handleReservarManual : undefined}
                  />
                </div>
              );
            })}
            {elementos.map((el) => (
              <ElementoItem
                key={el.id_elemento}
                el={el}
                esDuenio={esDuenio}
                setDragging={setDragging}
                rotarElemento={rotarElemento}
              />
            ))}
            </div>
          </div>
        </div>
      </div>
      {showCalendarioModal && (
        <div
          className="modal-fechas"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (modalContentRef.current && !modalContentRef.current.contains(e.target)) {
              setShowCalendarioModal(false);
            }
          }}
        >
          <div className="modal-fechas-content" ref={modalContentRef} onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="modal-fechas-close"
              aria-label="Cerrar"
              onClick={() => setShowCalendarioModal(false)}
            >
              ✕
            </button>
            <h3 className="modal-fechas-title">Selecciona tu rango de fechas</h3>
            <DateRange
              editableDateInputs={true}
              onChange={(item) => setRangoFechasDraft([item.selection])}
              moveRangeOnFirstSelection={false}
              ranges={rangoFechasDraft}
              months={2}
              direction="horizontal"
              rangeColors={["#005984"]}
              minDate={new Date()}
            />
            <div className="modal-fechas-actions">
              <button
                className="panel-button primary"
                onClick={() => {
                  setRangoFechas(rangoFechasDraft);
                  setShowCalendarioModal(false);
                }}
                disabled={actualizandoDisponibilidad}
              >
                Aceptar
              </button>
              <button
                className="panel-button secondary"
                onClick={() => setShowCalendarioModal(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <ServiciosSection
        balnearioInfo={balnearioInfo}
        esDuenio={esDuenio}
        mostrarModalServicios={mostrarModalServicios}
        setMostrarModalServicios={setMostrarModalServicios}
        todosLosServicios={todosLosServicios}
        toggleServicio={toggleServicio}
      />
      <AgregarCarpaModal
        mostrarAgregarCarpa={mostrarAgregarCarpa}
        setMostrarAgregarCarpa={setMostrarAgregarCarpa}
        nuevaCarpa={nuevaCarpa}
        setNuevaCarpa={setNuevaCarpa}
        tiposUbicacion={tiposUbicacion}
        handleAgregarCarpa={handleAgregarCarpa}
        precios={precios}
        onAgregarPrecio={onAgregarPrecio}
      />
      <EditarCarpaModal
        carpaEditando={carpaEditando}
        handleInputChange={handleInputChange}
        guardarCambios={guardarCambios}
        setCarpaEditando={setCarpaEditando}
      />
      <PreciosBalnearioTabla
        precios={precios}
        esDuenio={esDuenio}
        abrirModalPrecio={abrirModalPrecio}
      />
      <EditarPrecioModal
        editandoPrecio={editandoPrecio}
        precioEdit={precioEdit}
        setPrecioEdit={setPrecioEdit}
        guardarPrecio={guardarPrecio}
        setEditandoPrecio={setEditandoPrecio}
      />
      <ReseniasSection
        loadingResenias={loadingResenias}
        handleRetrocederResenias={handleRetrocederResenias}
        handleAvanzarResenias={handleAvanzarResenias}
        indiceResenia={indiceResenia}
        animating={animating}
        handleTransitionEnd={handleTransitionEnd}
        reseñasExtendidas={reseñasExtendidas}
        CARD_WIDTH={CARD_WIDTH}
        RESEÑAS_POR_VISTA={RESEÑAS_POR_VISTA}
        likeResenia={likeResenia}
        usuarioLogueado={usuarioLogueado}
        esDuenio={esDuenio}
        reseniaNueva={reseniaNueva}
        setReseniaNueva={setReseniaNueva}
        agregarResenia={agregarResenia}
      />
      <ReservaManualModal
        mostrar={mostrarReservaManual}
        setMostrar={setMostrarReservaManual}
        carpa={carpaParaReservar}
        fechaInicio={fechaInicio}
        fechaFin={fechaFin}
        onReservar={reservarManual}
      />
      {/* El chat del agente no se duplica aquí */}
    </div>
  );
}

export default CarpasDelBalneario;