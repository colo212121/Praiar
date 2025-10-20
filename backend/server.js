import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { supabase, supabaseAdmin } from './supabaseClient.js';
import nodemailer from 'nodemailer';
import { transporter, sendEmail, createReservaNotificationEmail, createApprovalEmail, createRejectionEmail } from './emailConfig.js';
import morgan from 'morgan';
import { elAgente } from './Agente/src/agent.js';
import { Busqueda } from './Agente/lib/busqueda.js';
import 'dotenv/config';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';


const app = express();
app.use(cors({ methods: ['GET','POST','PUT','DELETE','OPTIONS'], origin: true }));
app.use(express.json());
app.use(morgan('dev'));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configuración de Mercado Pago (usar variable de entorno)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN no configurado. Las rutas de pago devolverán error hasta configurarlo.');
}
const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN || '' });
const mpPreference = new Preference(mpClient);
const mpPayment = new Payment(mpClient);

// URLs base configurables
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Verificar SMTP al inicio (log informativo)
if (!process.env.BREVO_API_KEY) {
  try {
    transporter.verify().then(() => {
      console.log('[EMAIL] Transporter SMTP listo para enviar (Brevo).');
    }).catch((e) => {
      console.warn('[EMAIL] No se pudo verificar SMTP:', e?.message || e);
    });
  } catch (e) {
    console.warn('[EMAIL] Error inicializando verificación SMTP');
  }
} else {
  console.log('[EMAIL] Usando Brevo API (no se verifica SMTP)');
}

const chatMemory = new Map();
const chatState = new Map(); // chatId -> { ciudad: string|null, balnearioId: number|null }
let ciudadesCache = null;
let ciudadesCacheTs = 0;
const busquedaRapida = new Busqueda();

function normalizeText(s) {
  try {
    return (s || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
  } catch {
    return (s || '').toString().toLowerCase();
  }
}

function extractDateRange(raw) {
  const text = (raw || '').toString();
  // Try ISO first: 2025-01-05 ... 2025-01-10
  const iso = text.match(/(\d{4}-\d{2}-\d{2}).{0,20}(\d{4}-\d{2}-\d{2})/);
  if (iso) return { fi: iso[1], ff: iso[2] };

  // dd/mm/yyyy ... dd/mm/yyyy
  const dmy = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}).{0,20}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
  if (dmy) {
    const toIso = (s) => {
      const [d, m, y] = s.replace(/-/g,'/').split('/').map(x=>x.padStart(2,'0'));
      return `${y}-${m}-${d}`;
    };
    return { fi: toIso(dmy[1]), ff: toIso(dmy[2]) };
  }

  // Spanish month names: "del 9 de noviembre al 12 de noviembre de 2025"
  const lower = text.toLowerCase();
  const months = {
    'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
    'julio':'07','agosto':'08','septiembre':'09','setiembre':'09','octubre':'10','noviembre':'11','diciembre':'12',
    'ene':'01','feb':'02','mar':'03','abr':'04','may':'05','jun':'06','jul':'07','ago':'08','sep':'09','oct':'10','nov':'11','dic':'12'
  };
  const monthRegex = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)';
  const rgx = new RegExp(`(?:del?\\s*)?(\\d{1,2})\\s*de\\s*${monthRegex}(?:\\s*de\\s*(\\d{4}))?[^\\d]{0,30}(?:al\\s*)?(\\d{1,2})\\s*de\\s*${monthRegex}(?:\\s*de\\s*(\\d{4}))?`, 'i');
  const m = lower.match(rgx);
  if (m) {
    const d1 = String(m[1]).padStart(2,'0');
    const mo1 = months[m[2]];
    const y1 = m[3] ? m[3] : null;
    const d2 = String(m[4]).padStart(2,'0');
    const mo2 = months[m[5]];
    const y2 = m[6] ? m[6] : null;
    const year = y2 || y1 || String(new Date().getFullYear());
    const fiYear = y1 || year;
    const ffYear = y2 || year;
    if (mo1 && mo2) {
      return { fi: `${fiYear}-${mo1}-${d1}`, ff: `${ffYear}-${mo2}-${d2}` };
    }
  }

  return null;
}
async function getCiudadesLista() {
  const now = Date.now();
  if (ciudadesCache && (now - ciudadesCacheTs) < 5 * 60 * 1000) {
    return ciudadesCache;
  }
  try {
    const { data, error } = await supabase
      .from('ciudades')
      .select('nombre')
      .order('nombre', { ascending: true });
    if (error) throw error;
    ciudadesCache = (data || []).map(c => c.nombre).filter(Boolean);
    ciudadesCacheTs = now;
  } catch (e) {
    ciudadesCache = [];
  }
  return ciudadesCache;
}

// Intenta inferir un balneario por nombre desde el mensaje (opcionalmente filtra por ciudad)
async function inferBalnearioIdFromMessage(message, ciudadPreferida = null) {
  try {
    const texto = (message || '').toString();
    const lista = await busquedaRapida.buscarBalneariosPorNombre(texto);
    if (!lista || lista.length === 0) return null;
    // Normalizar texto para match inclusivo por nombre
    const normMsg = normalizeText(texto);
    let candidatos = lista.filter(b => normMsg.includes(normalizeText(b.nombre)));
    if (ciudadPreferida) {
      const normCity = normalizeText(ciudadPreferida);
      const enCiudad = candidatos.filter(b => normalizeText(b.ciudad || '').includes(normCity));
      if (enCiudad.length) candidatos = enCiudad;
    }
    const primero = candidatos[0] || lista[0];
    return primero?.id_balneario || null;
  } catch {
    return null;
  }
}

app.post('/api/chat', async (req, res) => {
  const { message, session, chatId } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'No message provided' });
  }

  try {
    // Inyecta contexto de sesión al mensaje y ejecuta el agente con una sola firma
    const ciudadesDisponibles = await getCiudadesLista();
    const sessionContextLine = session
      ? `\n[Contexto de sesión]\n- isLoggedIn: ${!!session.isLoggedIn}\n- esPropietario: ${!!session.esPropietario}\n- auth_id: ${session.auth_id || 'N/A'}\n- nombre: ${session.nombre || 'N/A'}\n- email: ${session.email || 'N/A'}\n`
      : `\n[Contexto de sesión]\n- isLoggedIn: false\n`;
    const ciudadesBlock = '';
    const history = chatId ? (chatMemory.get(chatId) || []) : [];
    // Detectar intents de reseteo
    const lower = (message || '').toLowerCase();
    let resetMarker = '';
    if (chatId && /(reset|reiniciar|empezar de cero)/i.test(lower)) {
      chatMemory.set(chatId, []);
      resetMarker = '\n[Reset total]';
    } else if (/(cambiar|otra)\s+ciudad/i.test(lower)) {
      resetMarker = '\n[Reset ciudad]';
    } else if (/(cambiar|otra)\s+fecha|me equivoqué de fecha|equivocado de fecha/i.test(lower)) {
      resetMarker = '\n[Reset fechas]';
    }
    const historyPrefix = history.length ? `\n[Historial breve]\n${history.join('\n')}` : '';
    const finalMessage = `${sessionContextLine}${historyPrefix}${resetMarker}\n${message}`;

    // Saludo y onboarding si el usuario solo saluda o si no hay contexto
    const isGreeting = /^(hola|buenas|hello|hey|qué tal|como andas|como estas)[!.\s]*$/i.test(message.trim());
    if (isGreeting || history.length === 0) {
      const saludo = 'Hola, ¿cómo estás? Decime la ciudad a la que querés ir y, si querés, las fechas. Después elegimos el balneario y te doy el link listo.';
      if (!isGreeting) {
        // continúa con el agente si no fue un saludo puro
      } else {
        // Responder directo al saludo y no invocar al LLM innecesariamente
        if (chatId) {
          const next = [...history, `U: ${message}`, `A: ${saludo}`];
          chatMemory.set(chatId, next.slice(-6));
        }
        return res.json({ response: saludo });
      }
    }

    // Fallback NLU local + estado conversacional
    try {
      const normMsg = normalizeText(message);
      // Intent explícito: listar ciudades
      if (/(listar|lista|que|qué)\s+ciudades/.test(normMsg)) {
        const ciudades = await getCiudadesLista();
        const top = (ciudades || []).slice(0, 5);
        const texto = top.length ? `Estas son algunas ciudades disponibles:\n- ${top.join('\n- ')}` : 'No hay ciudades registradas ahora.';
        if (chatId) {
          const next = [...history, `U: ${message}`, `A: ${texto}`];
          chatMemory.set(chatId, next.slice(-6));
        }
        return res.json({ response: texto });
      }
      const matchedCiudades = (ciudadesDisponibles || []).filter(c => {
        const nc = normalizeText(c);
        return nc && normMsg.includes(nc);
      });
      const state = chatId ? (chatState.get(chatId) || { ciudad: null, balnearioId: null }) : { ciudad: null, balnearioId: null };

      // Paso 1: detectar ciudad
      if (matchedCiudades.length === 1) {
        const ciudadElegida = matchedCiudades[0];
        state.ciudad = ciudadElegida;
        state.balnearioId = null; // reset balneario si cambió ciudad
        if (chatId) chatState.set(chatId, state);

        const lista = await busquedaRapida.buscarBalneariosPorCiudad(ciudadElegida);
        if (!lista || lista.length === 0) {
          const texto = `No encontré balnearios en ${ciudadElegida}. Probá con otra ciudad.`;
          if (chatId) {
            const next = [...history, `U: ${message}`, `A: ${texto}`];
            chatMemory.set(chatId, next.slice(-6));
          }
          return res.json({ response: texto });
        }
        const top = lista.slice(0, 5).map(b => `- ${b.nombre} — /balneario/${b.id_balneario}`).join('\n');
        const texto = `Perfecto, ${ciudadElegida}. Elegí un balneario de esta lista (máx 5):\n${top}`;
        if (chatId) {
          const next = [...history, `U: ${message}`, `A: ${texto}`];
          chatMemory.set(chatId, next.slice(-6));
        }
        return res.json({ response: texto });
      }

      // Paso 2: si ya hay ciudad en estado, intentar detectar balneario por nombre dentro de la ciudad
      if (state.ciudad) {
        const lista = await busquedaRapida.buscarBalneariosPorCiudad(state.ciudad);
        const candidatos = (lista || []).filter(b => normalizeText(b.nombre) && normMsg.includes(normalizeText(b.nombre)));
        if (candidatos.length === 1) {
          const elegido = candidatos[0];
          state.balnearioId = elegido.id_balneario;
          if (chatId) chatState.set(chatId, state);
          const texto = `Genial, ${elegido.nombre}. Decime el rango de fechas (por ejemplo: 2025-01-05 a 2025-01-10).`;
          if (chatId) {
            const next = [...history, `U: ${message}`, `A: ${texto}`];
            chatMemory.set(chatId, next.slice(-6));
          }
          return res.json({ response: texto });
        }
      }

      // Paso 3: fechas -> verificar y devolver link. Si falta balneario en estado, inferirlo del mensaje.
      const rango = extractDateRange(message);
      if (rango && rango.fi && rango.ff) {
        let balId = state.balnearioId;
        if (!balId) {
          balId = await inferBalnearioIdFromMessage(message, state.ciudad);
          if (balId) {
            state.balnearioId = balId;
            if (chatId) chatState.set(chatId, state);
          }
        }
        if (balId) {
          let ok = false;
          try {
            const dispo = await busquedaRapida.verificarDisponibilidadDeBalneario(balId, rango.fi, rango.ff);
            ok = dispo && typeof dispo.disponibles === 'number' && dispo.disponibles > 0;
          } catch {}
          const link = `/balneario/${balId}?fi=${rango.fi}&ff=${rango.ff}`;
          const texto = ok
            ? `${link}\nListo, te llevo con esas fechas. Si querés cambiar algo, decime.`
            : `${link}\nTe dejo el link con ese rango. Si no ves disponibilidad, probemos otras fechas.`;
          if (chatId) {
            const next = [...history, `U: ${message}`, `A: ${texto}`];
            chatMemory.set(chatId, next.slice(-6));
          }
          return res.json({ response: texto });
        }
      }
    } catch {}

    const respuesta = await elAgente.run(finalMessage);
    // Normalizar a texto plano y ocultar bloques <think>
    let text = '';
    if (typeof respuesta === 'string') {
      text = respuesta;
    } else if (respuesta && typeof respuesta === 'object') {
      // Intentar múltiples formas comunes
      text = respuesta.data?.result
        || respuesta.data?.message
        || respuesta.message
        || respuesta.output?.text
        || respuesta.output
        || respuesta.result
        || '';
    }
    if (typeof text !== 'string') text = String(text || '');
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/i, '').trim();

    // Guardar último turno (limitado) para contexto minimalista
    if (chatId) {
      const next = [...history, `U: ${message}`, `A: ${cleanText}`];
      // Mantener solo los últimos 6 mensajes (3 turnos)
      chatMemory.set(chatId, next.slice(-6));
    }
    res.json({ response: cleanText });
  } catch (error) {
    console.error('Error en el agente:', error);
    // Fallback amable para no romper el flujo en el frontend
    const fallback = 'Tuve un problema procesando tu pedido. Decime la ciudad (por ejemplo: "Mar del Plata") y, si querés, las fechas (YYYY-MM-DD a YYYY-MM-DD). Te voy guiando.';
    try {
      if (chatId) {
        const history = chatMemory.get(chatId) || [];
        const next = [...history, `U: ${req.body?.message || ''}`, `A: ${fallback}`];
        chatMemory.set(chatId, next.slice(-6));
      }
    } catch {}
    res.json({ response: fallback });
  }
});

// post /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  const { data: authData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (loginError || !authData.user) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  const userId = authData.user.id;

  const { data: usuario, error: fetchError } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_id', userId)
    .limit(1)
    .maybeSingle();

  if (fetchError || !usuario) {
    return res.status(500).json({ error: 'No se pudo obtener el perfil del usuario' });
  }

  res.json({ usuario });
});

// post /api/registrar
app.post('/api/registrar', upload.single('imagen'), async (req, res) => {
  try {
    const {
      nombre, apellido, email, dni, telefono, password, esPropietario, codigoPais
    } = req.body;
    
    if (!nombre?.trim() || !apellido?.trim()) {
      return res.status(400).json({ error: 'Nombre y apellido son obligatorios.' });
    }
    if (!email?.trim() || !email.includes('@')) {
      return res.status(400).json({ error: 'El email es obligatorio y debe ser válido.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (!telefono?.trim() || telefono.length < 6) {
      return res.status(400).json({ error: 'El teléfono es obligatorio y debe ser válido.' });
    }
    if (!dni?.trim() || dni.length < 6) {
      return res.status(400).json({ error: 'El DNI es obligatorio y debe ser válido.' });
    }

    const telefonoCompleto = (codigoPais || '+54') + telefono;
    const condiciones = [];
    if (email) condiciones.push(`email.eq.${encodeURIComponent(email)}`);
    if (dni && !isNaN(dni)) condiciones.push(`dni.eq.${parseInt(dni, 10)}`);
    if (telefono) condiciones.push(`telefono.eq.${telefonoCompleto}`);
    const orString = condiciones.join(',');

    if (orString === '') {
      return res.status(400).json({ error: 'Debe ingresar email, dni o teléfono.' });
    }

    const { data: existeUsuario, error: existeError } = await supabase
      .from('usuarios')
      .select('id_usuario')
      .or(orString);

    if (existeError) {
      return res.status(500).json({ error: 'Error verificando duplicados. Intente nuevamente.' });
    }
    if (existeUsuario && existeUsuario.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario registrado con este email, DNI o teléfono.' });
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    if (signUpError || !signUpData.user) {
      return res.status(500).json({ error: 'Error al registrar usuario: ' + (signUpError?.message || '') });
    }

    const userId = signUpData.user.id;
    const userEmail = signUpData.user.email;

    let imageUrl = null;
    if (req.file) {
      const fileExt = req.file.originalname.split('.').pop();
      const fileName = `${userId}.${fileExt}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('usuarios')
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        return res.status(500).json({ error: 'Error al subir imagen de perfil.' });
      }

      const { data: publicUrlData } = supabase.storage
        .from('usuarios')
        .getPublicUrl(filePath);

      imageUrl = publicUrlData.publicUrl;
    }

    const { data: perfil, error: insertError } = await supabase
      .from('usuarios')
      .insert([
        {
          auth_id: userId,
          nombre,
          apellido,
          email: userEmail,
          telefono: telefonoCompleto,
          esPropietario: String(esPropietario) === 'true' || esPropietario === true,
          dni,
          imagen: imageUrl,
        },
      ])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({
        error: 'Error al guardar los datos del usuario. Por favor contacte a soporte. No intente registrarse nuevamente con el mismo email.'
      });
    }

    res.json({ usuario: perfil });
  } catch (err) {
    console.error('Error en /api/registrar:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// post /api/logout
app.post('/api/logout', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Falta el token de sesión.' });
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return res.status(500).json({ error: 'Error al cerrar sesión.' });
  }

  res.json({ success: true });
});


// get /api/ciudades
app.get('/api/ciudades', async (req, res) => {
  const { data: ciudadesData, error: ciudadesError } = await supabase
    .from('ciudades')
    .select('id_ciudad, nombre, img')
    .order('nombre', { ascending: true });

  if (ciudadesError) return res.status(500).json({ error: ciudadesError.message });

  const ciudadesConCantidad = await Promise.all(
    ciudadesData.map(async (ciudad) => {
      const { count, error: countError } = await supabase
        .from('balnearios')
        .select('*', { count: 'exact', head: true })
        .eq('id_ciudad', ciudad.id_ciudad);

      if (countError) return { ...ciudad, cantidadBalnearios: 0 };
      return { ...ciudad, cantidadBalnearios: typeof count === 'number' ? count : 0 };
    })
  );

  ciudadesConCantidad.sort((a, b) => b.cantidadBalnearios - a.cantidadBalnearios);
  res.json(ciudadesConCantidad);
});

app.get('/api/balnearios', async (req, res) => {
  const ciudadId = req.query.ciudad_id;

  if (!ciudadId) return res.status(400).json({ error: 'Falta el parámetro ciudad_id' });

  const { data, error } = await supabase
    .from('balnearios')
    .select('id_balneario, nombre')
    .eq('id_ciudad', ciudadId);

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// get /api/perfil/:auth_id
app.get('/api/perfil/:auth_id', async (req, res) => {
  const { auth_id } = req.params;

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_id', auth_id)
    .single();

  if (error || !usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  res.json({ usuario });
});

// put /api/perfil/:auth_id
app.put('/api/perfil/:auth_id', async (req, res) => {
  const { auth_id } = req.params;
  const { nombre, apellido, email, dni, telefono } = req.body;

  if (!auth_id) return res.status(400).json({ error: 'Falta el auth_id.' });

  const { data, error } = await supabase
    .from('usuarios')
    .update({
      nombre,
      apellido,
      email,
      dni,
      telefono,
    })
    .eq('auth_id', auth_id)
    .select()
    .maybeSingle();

  if (error || !data) {
    return res.status(500).json({ error: error?.message || 'Error al actualizar usuario.' });
  }

  res.json({ usuario: data });
});


// post /api/consultas
app.post('/api/consultas', async (req, res) => {
  const { nombre, mail, problema, id_usuario } = req.body;

  try {
    const { error } = await supabase
      .from('consultas')
      .insert([{ nombre_usuario: nombre, mail_usuario: mail, problema, id_usuario }]);

    if (error) throw error;

    res.status(200).json({ mensaje: 'Consulta enviada correctamente.' });
  } catch (error) {
    console.error('Error en /api/consultas:', error.message);
    res.status(500).json({ error: 'Error al guardar la consulta.' });
  }
});

// GET /api/mis-balnearios?auth_id=el-uuid
app.get('/api/mis-balnearios', async (req, res) => {
  const { auth_id } = req.query;

  if (!auth_id) {
    return res.status(400).json({ error: 'Falta el auth_id del usuario.' });
  }

  try {
    const { data: balnearios, error } = await supabase
      .from('balnearios')
      .select('*')
      .eq('id_usuario', auth_id);

    if (error) {
      return res.status(500).json({ error: 'Error cargando balnearios.' });
    }

    res.json({ balnearios });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Crear balneario (modificado para aceptar campo imagen, aunque se setea después)
app.post('/api/crear-balneario', async (req, res) => {
  const {
    nombre,
    direccion,
    telefono,
    ciudadSeleccionada,
    idUsuario,
    tandasCarpas, // array de todas las tandas
    precios,
    imagen       // <-- nuevo campo, puede venir vacío inicialmente
  } = req.body;

  if (!idUsuario) {
    return res.status(400).json({ error: 'Falta el id del usuario.' });
  }
  if (!ciudadSeleccionada) {
    return res.status(400).json({ error: 'Debe seleccionar una ciudad.' });
  }
  if (!Array.isArray(tandasCarpas) || tandasCarpas.length === 0) {
    return res.status(400).json({ error: 'Debe agregar al menos una tanda de carpas.' });
  }
  if (!Array.isArray(precios) || precios.length === 0) {
    return res.status(400).json({ error: 'Debe ingresar al menos un precio.' });
  }
  if (precios.some(p => !p.dia || !p.semana || !p.quincena || !p.mes || !p.id_tipo_ubicacion)) {
    return res.status(400).json({ error: 'Cada precio debe estar completo.' });
  }

  try {
    // 1. Crear el balneario
    const { data: balnearioData, error: balnearioError } = await supabase
      .from("balnearios")
      .insert([{
        nombre,
        direccion,
        telefono,
        id_usuario: idUsuario,
        id_ciudad: ciudadSeleccionada,
        imagen: imagen || null // campo imagen principal (puede ir null)
      }])
      .select()
      .single();

    if (balnearioError) {
      return res.status(500).json({ error: "Error al guardar el balneario." });
    }

    const nuevoBalnearioId = balnearioData.id_balneario;

    // 2. Crear los precios asociados a este balneario
    const preciosAInsertar = precios.map(p => ({
      id_balneario: nuevoBalnearioId,
      id_tipo_ubicacion: p.id_tipo_ubicacion,
      dia: p.dia,
      semana: p.semana,
      quincena: p.quincena,
      mes: p.mes
    }));
    const { error: precioError } = await supabase
      .from("precios")
      .insert(preciosAInsertar);

    // 3. Crear todas las carpas de todas las tandas
    let ubicaciones = [];
    let pos = 1;
    tandasCarpas.forEach((tanda) => {
      const {
        id_tipo_ubicacion,
        cantidadCarpas,
        cantSillas,
        cantMesas,
        cantReposeras,
        capacidad
      } = tanda;
      const maxPorFila = 10, anchoCarpa = 100, altoCarpa = 100;
      for (let i = 0; i < cantidadCarpas; i++, pos++) {
        const fila = Math.floor((pos-1) / maxPorFila);
        const columna = (pos-1) % maxPorFila;
        ubicaciones.push({
          id_balneario: nuevoBalnearioId,
          id_tipo_ubicacion: id_tipo_ubicacion,
          posicion: pos,
          reservado: false,
          cant_sillas: cantSillas,
          cant_mesas: cantMesas,
          cant_reposeras: cantReposeras,
          capacidad: capacidad,
          id_usuario: idUsuario,
          x: columna * anchoCarpa,
          y: fila * altoCarpa,
        });
      }
    });

    const { error: carpasError } = await supabase
      .from("ubicaciones")
      .insert(ubicaciones);

    if (carpasError) {
      return res.status(500).json({ error: "Balneario y precios creados, pero ocurrió un error al crear las carpas." });
    }

    // Devuelve ID para subir imágenes
    res.status(200).json({ 
      mensaje: 'Balneario, precios y carpas creados correctamente.',
      id_balneario: nuevoBalnearioId
    });
  } catch (err) {
    console.error("Error en /api/crear-balneario:", err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Sube las imágenes y las registra en la tabla balneario_imagenes
app.post('/api/crear-imagenes-balneario', upload.array('imagenes'), async (req, res) => {
  const { id_balneario } = req.body;
  const files = req.files;

  if (!id_balneario || !files || files.length === 0) {
    return res.status(400).json({ error: "Datos incompletos." });
  }

  try {
    // Subir cada imagen al bucket balnearios
    let urls = [];
    for (const file of files) {
      // Guardar en subcarpeta por balneario
      const path = `balnearios/${id_balneario}/${file.originalname}`;
      const { error: uploadError } = await supabase.storage
        .from("balnearios")
        .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
      if (uploadError) {
        return res.status(500).json({ error: "Error al subir imágenes." });
      }
      // Obtener URL pública
      const { data } = supabase.storage.from("balnearios").getPublicUrl(path);
      urls.push(data.publicUrl);
    }

    // Registrar las imágenes en la tabla balneario_imagenes
    const registros = urls.map(url => ({
      id_balneario,
      url
    }));
    const { error: bdError } = await supabase
      .from("balneario_imagenes")
      .insert(registros);

    if (bdError) {
      return res.status(500).json({ error: "Error al registrar imágenes." });
    }

    res.status(200).json({ mensaje: "Imágenes registradas correctamente.", urls });
  } catch (err) {
    console.error("Error en /api/crear-imagenes-balneario:", err);
    res.status(500).json({ error: "Error interno al subir imágenes." });
  }
});

// NUEVO ENDPOINT: Actualiza el campo imagen principal en balnearios
app.post('/api/actualizar-imagen-principal', async (req, res) => {
  const { id_balneario, imagen } = req.body;
  if (!id_balneario || !imagen) {
    return res.status(400).json({ error: "Faltan datos." });
  }
  try {
    const { error } = await supabase
      .from("balnearios")
      .update({ imagen })
      .eq("id_balneario", id_balneario);
    if (error) {
      return res.status(500).json({ error: "Error al actualizar la imagen principal." });
    }
    res.status(200).json({ mensaje: "Imagen principal actualizada." });
  } catch (err) {
    console.error("Error en /api/actualizar-imagen-principal:", err);
    res.status(500).json({ error: "Error interno." });
  }
});

// Endpoint GET para traer las imágenes de un balneario
app.get('/api/balneario/:id_balneario/imagenes', async (req, res) => {
  const { id_balneario } = req.params;
  // Usando Supabase para traer las imágenes
  const { data, error } = await supabase
    .from('balneario_imagenes')
    .select('id_imagen,url')
    .eq('id_balneario', id_balneario)
    .order('id_imagen', { ascending: true });

  if (error) {
    return res.status(500).json({ error: 'Error al obtener imágenes del balneario' });
  }
  res.json({ imagenes: data });
});

// Nuevo endpoint sugerido para traer tipos de ubicaciones
app.get('/api/tipos-ubicaciones', async (req, res) => {
  try {
    const { data, error } = await supabase.from("tipos_ubicaciones").select("*");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener tipos de ubicaciones" });
  }
});

// GET /api/balneario/:id/precios
app.get('/api/balneario/:id/precios', async (req, res) => {
  const { id } = req.params;
  // Join con tipos_ubicaciones para traer el nombre
  const { data, error } = await supabase
    .from("precios")
    .select("id_tipo_ubicacion, dia, semana, quincena, mes, tipos_ubicaciones(nombre)")
    .eq("id_balneario", id);
  if (error) return res.status(500).json({ error: "Error trayendo precios." });

  // Mapear para que sea { id_tipo_ubicacion, nombre, dia, semana, ... }
  const precios = (data || []).map(p => ({
    id_tipo_ubicacion: p.id_tipo_ubicacion,
    nombre: p.tipos_ubicaciones?.nombre || "Desconocido",
    dia: p.dia,
    semana: p.semana,
    quincena: p.quincena,
    mes: p.mes,
  }));

  res.json(precios);
});

// POST /api/balneario/:id/precios
app.post('/api/balneario/:id/precios', async (req, res) => {
  const { id } = req.params;
  const { id_tipo_ubicacion, dia, semana, quincena, mes } = req.body;

  if (!id || !id_tipo_ubicacion || !dia || !semana || !quincena || !mes) {
    return res.status(400).json({ error: 'Faltan datos obligatorios para el precio.' });
  }

  // Verificar que no exista ya precio para ese tipo
  const { data: precioExistente, error: precioError } = await supabase
    .from("precios")
    .select("*")
    .eq("id_balneario", id)
    .eq("id_tipo_ubicacion", id_tipo_ubicacion)
    .maybeSingle();

  if (precioError) {
    return res.status(500).json({ error: "Error buscando precio existente." });
  }
  if (precioExistente) {
    return res.status(400).json({ error: "Ya existe un precio para este tipo de ubicación en este balneario." });
  }

  // Insertar el precio
  const { data, error } = await supabase
    .from('precios')
    .insert([{
      id_balneario: id,
      id_tipo_ubicacion,
      dia,
      semana,
      quincena,
      mes
    }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Error agregando precio.' });
  }

  res.json(data);
});

// --------- ENDPOINTS PARA CarpasDelBalneario ------------

// GET /api/balneario/:id/info
app.get('/api/balneario/:id/info', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: balneario, error } = await supabase
      .from("balnearios")
      .select("*")
      .eq("id_balneario", id)
      .single();
    if (error || !balneario) return res.status(404).json({ error: 'Balneario no encontrado.' });

    let ciudadNombre = "";
    if (balneario.id_ciudad) {
      const { data: ciudadData } = await supabase
        .from("ciudades")
        .select("nombre")
        .eq("id_ciudad", balneario.id_ciudad)
        .single();
      ciudadNombre = ciudadData?.nombre || "";
    }

    // Servicios
    const { data: relaciones } = await supabase
      .from("balnearios_servicios")
      .select("id_servicio")
      .eq("id_balneario", id);

    const idsServicios = relaciones?.map(r => r.id_servicio) || [];
    let servicios = [];
    if (idsServicios.length > 0) {
      const { data: serviciosData } = await supabase
        .from("servicios")
        .select("id_servicio, nombre, imagen")
        .in("id_servicio", idsServicios);
      servicios = serviciosData || [];
    }

    res.json({
      ...balneario,
      ciudad: ciudadNombre,
      servicios
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/balneario/:id/carpas
app.get('/api/balneario/:id/carpas', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: carpas, error } = await supabase
      .from("ubicaciones")
      .select("*")
      .eq("id_balneario", id);

    if (error) return res.status(500).json({ error: 'Error cargando carpas.' });
    res.json(carpas);
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/balneario/:id/elementos
app.get('/api/balneario/:id/elementos', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: elementos, error } = await supabase
      .from("elementos_ubicacion")
      .select("*")
      .eq("id_balneario", id);

    if (error) return res.status(500).json({ error: 'Error cargando elementos.' });
    res.json(elementos);
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/balneario/:id/servicios-todos
app.get('/api/balneario/:id/servicios-todos', async (req, res) => {
  try {
    const { data: servicios, error } = await supabase
      .from("servicios")
      .select("id_servicio, nombre, imagen");
    if (error) return res.status(500).json({ error: 'Error cargando servicios.' });
    res.json(servicios);
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// POST /api/balneario/:id/servicio
app.post('/api/balneario/:id/servicio', async (req, res) => {
  const { id } = req.params;
  const { id_servicio } = req.body;
  try {
    const { error } = await supabase
      .from("balnearios_servicios")
      .insert({ id_balneario: Number(id), id_servicio: Number(id_servicio) });
    if (error) return res.status(500).json({ error: 'Error agregando servicio.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// DELETE /api/balneario/:id/servicio/:id_servicio
app.delete('/api/balneario/:id/servicio/:id_servicio', async (req, res) => {
  const { id, id_servicio } = req.params;
  try {
    const { error } = await supabase
      .from("balnearios_servicios")
      .delete()
      .match({ id_balneario: Number(id), id_servicio: Number(id_servicio) });
    if (error) return res.status(500).json({ error: 'Error quitando servicio.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// POST /api/balneario/:id/elemento
app.post('/api/balneario/:id/elemento', async (req, res) => {
  const { id } = req.params;
  const { tipo, x = 100, y = 100 } = req.body;
  try {
    const { data, error } = await supabase
      .from("elementos_ubicacion")
      .insert({ id_balneario: id, tipo, x, y })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Error agregando elemento.' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// PUT /api/balneario/carpas/:id_carpa
app.put('/api/balneario/carpas/:id_carpa', async (req, res) => {
  const { id_carpa } = req.params;
  const updateData = req.body;
  try {
    const { error } = await supabase
      .from("ubicaciones")
      .update(updateData)
      .eq("id_carpa", id_carpa);
    if (error) return res.status(500).json({ error: 'Error actualizando carpa.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// DELETE /api/balneario/carpas/:id_carpa
app.delete('/api/balneario/carpas/:id_carpa', async (req, res) => {
  const { id_carpa } = req.params;
  try {
    const { error } = await supabase
      .from("ubicaciones")
      .delete()
      .eq("id_carpa", id_carpa);
    if (error) return res.status(500).json({ error: 'Error eliminando carpa.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// === MERCADO PAGO: Crear preferencia y Webhook ===
app.post('/api/mercadopago/create-preference', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Mercado Pago no está configurado (MP_ACCESS_TOKEN faltante).' });
    }
    const { descripcion, precio, email } = req.body;
    if (!precio || Number.isNaN(Number(precio))) {
      return res.status(400).json({ error: 'Precio inválido.' });
    }
    const preference = {
      items: [
        {
          title: descripcion || 'Reserva Praiar',
          unit_price: Number(precio),
          quantity: 1,
          currency_id: 'ARS'
        }
      ],
      ...(email ? { payer: { email } } : {}),
      metadata: {
        origen: 'Praiar',
        descripcion: descripcion || 'Reserva Praiar',
      },
      back_urls: {
        success: `${FRONTEND_URL}/pago-exitoso`,
        failure: `${FRONTEND_URL}/pago-fallido`,
        pending: `${FRONTEND_URL}/pago-pendiente`
      },
      binary_mode: true,
      notification_url: `${SERVER_URL}/api/mercadopago/webhook`,
      statement_descriptor: 'Praiar'
    };

    // Log debug para verificar payload enviado a MP (sin datos sensibles)
    console.log('MP Preference payload:', {
      items: preference.items,
      payer: preference.payer,
      back_urls: preference.back_urls,
      binary_mode: preference.binary_mode,
      notification_url: preference.notification_url,
      statement_descriptor: preference.statement_descriptor
    });

    const response = await mpPreference.create({ body: preference });
    return res.json({ init_point: response.init_point, sandbox_init_point: response.sandbox_init_point, id: response.id });
  } catch (error) {
    console.error('Error creando preferencia MP:', error);
    return res.status(500).json({ error: 'Error creando preferencia de pago.' });
  }
});

// Checkout API: crea un pago directo con tarjeta/token (no usa Checkout Pro)
// Body esperado: { amount: number, email: string, installments: number, token: string }
app.post('/api/mercadopago/checkout-api/payment', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Mercado Pago no está configurado (MP_ACCESS_TOKEN faltante).' });
    }

    const { amount, email, installments = 1, token } = req.body || {};
    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Monto inválido.' });
    }
    if (!email || !token) {
      return res.status(400).json({ error: 'Faltan datos de pago (email o token).' });
    }

    const payment = await mpPayment.create({
      body: {
        payer: { email },
        token,
        transaction_amount: Number(amount),
        installments: Number(installments) || 1,
      }
    });

    // Devuelvo status del pago para que el frontend actúe (approved/rejected/in_process)
    res.json({ id: payment.id, status: payment.status, status_detail: payment.status_detail });
  } catch (e) {
    console.error('[MP][CHECKOUT-API] Error creando pago:', e?.message || e);
    res.status(500).json({ error: 'Error creando pago con Checkout API.' });
  }
});

// Webhook/IPN de Mercado Pago: consulta el pago y registra su estado
app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    // MP puede enviar info en query (topic/id) o en body (data.id/type)
    const query = req.query || {};
    const body = req.body || {};

    const type = (query.type || query.topic || body.type || '').toString();
    const paymentId = (body?.data?.id || query['data.id'] || query.id || body?.id || body?.resource?.id || '').toString();

    console.log('[MP][WEBHOOK] type/topic:', type, 'paymentId:', paymentId);

    if (!MP_ACCESS_TOKEN) {
      console.warn('[MP][WEBHOOK] Access token faltante. No se puede consultar el pago.');
      return res.sendStatus(200);
    }

    if (type.includes('payment') && paymentId) {
      try {
        const payment = await mpPayment.get({ id: paymentId });
        console.log('[MP][WEBHOOK] Payment status:', payment.status, 'preference_id:', payment.preference_id);
        // Aquí podríamos conciliar reservas usando payment.preference_id / payment.metadata
        // Por ahora, solo se registra el estado del pago.
      } catch (err) {
        console.error('[MP][WEBHOOK] Error consultando pago:', err?.message || err);
      }
    }

    // Siempre responder 200 para evitar reintentos excesivos
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(200);
  }
});

// Endpoint auxiliar: obtener detalles de un pago concreto (debug/validación)
app.get('/api/mercadopago/payment/:id', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Mercado Pago no está configurado (MP_ACCESS_TOKEN faltante).' });
    }
    const { id } = req.params;
    const payment = await mpPayment.get({ id });
    res.json({ id: payment.id, status: payment.status, status_detail: payment.status_detail, preference_id: payment.preference_id, metadata: payment.metadata });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo obtener el pago.' });
  }
});

// Endpoint auxiliar: validar estado de pago por payment_id recibido en back_urls
app.post('/api/mercadopago/validate', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Mercado Pago no está configurado (MP_ACCESS_TOKEN faltante).' });
    }
    const { payment_id } = req.body;
    if (!payment_id) {
      return res.status(400).json({ error: 'payment_id es requerido.' });
    }
    const payment = await mpPayment.get({ id: String(payment_id) });
    res.json({ approved: payment.status === 'approved', status: payment.status, payment });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo validar el pago.' });
  }
});

// PUT /api/balneario/elementos/:id_elemento
app.put('/api/balneario/elementos/:id_elemento', async (req, res) => {
  const { id_elemento } = req.params;
  const updateData = req.body;
  try {
    const { error } = await supabase
      .from("elementos_ubicacion")
      .update(updateData)
      .eq("id_elemento", id_elemento);
    if (error) return res.status(500).json({ error: 'Error actualizando elemento.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/balneario/:id/reservas?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD
app.get('/api/balneario/:id/reservas', async (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin } = req.query;

  try {
    // 1. Traer todas las reservas de ese balneario en el rango de fechas
    let reservasQuery = supabase
      .from("reservas")
      .select("id_reserva, fecha_inicio, fecha_salida, Reservas_Ubicaciones(id_ubicacion)")
      .eq("id_balneario", id);

    if (fechaInicio && fechaFin) {
      reservasQuery = reservasQuery
        .lte("fecha_inicio", fechaFin)
        .gte("fecha_salida", fechaInicio);
    }

    const { data, error } = await reservasQuery;

    if (error) return res.status(500).json({ error: 'Error obteniendo reservas.' });

    // 2. Devolver como array de { id_ubicacion, fecha_inicio, fecha_salida }
    let reservas = [];
    (data || []).forEach(r => {
      (r.Reservas_Ubicaciones || []).forEach(vinculo => {
        reservas.push({
          id_ubicacion: vinculo.id_ubicacion,
          fecha_inicio: r.fecha_inicio,
          fecha_salida: r.fecha_salida
        });
      });
    });

    res.json(reservas);
  } catch (e) {
    res.status(500).json({ error: 'Error interno.' });
  }
});


// POST /api/reservas-balneario  (Propietario: ver reservas de su balneario)
app.post('/api/reservas-balneario', async (req, res) => {
  const { idBalneario, fechaInicio, fechaFin } = req.body;

  if (!idBalneario) {
    return res.status(400).json({ error: "Falta id del balneario." });
  }

  // 1. Consulta base: reservas + ubicaciones + balneario
  let query = supabase
    .from("reservas")
    .select(`
      *,
      Reservas_Ubicaciones (
        id_ubicacion,
        ubicaciones (
          id_carpa,
          posicion
        )
      ),
      balnearios (
        nombre
      )
    `)
    .eq("id_balneario", idBalneario);

  // 2. Agregar filtro de fechas si están presentes
  if (fechaInicio && fechaFin) {
    query = query
      .lte("fecha_inicio", fechaFin)
      .gte("fecha_salida", fechaInicio);
  }

  // 3. Ejecutar la consulta de reservas
  const { data, error } = await query;

  if (error) {
    console.error("Error en reservas:", error);
    return res.status(500).json({ error: "Error cargando reservas." });
  }

  if (!data || data.length === 0) {
    return res.json({ reservas: [] });
  }

  // 4. Extraer todos los id_usuario únicos
  const usuarioAuthIds = [...new Set(data.map(r => r.id_usuario).filter(Boolean))];

  // 5. Traer usuarios con auth_id en esos ids
  const { data: usuarios, error: errorUsuarios } = await supabase
    .from("usuarios")
    .select("auth_id, nombre, apellido, email, telefono")
    .in("auth_id", usuarioAuthIds);

  if (errorUsuarios) {
    console.error("Error trayendo usuarios:", errorUsuarios);
    return res.status(500).json({ error: "Error cargando datos de usuarios." });
  }

  // 6. Armar respuesta enriquecida
const reservas = data.map(r => {
  const usuario = usuarios.find(u => u.auth_id === r.id_usuario);
  return {
    id_reserva: r.id_reserva,
    id_usuario: r.id_usuario,
    cliente_nombre: usuario ? `${usuario.nombre} ${usuario.apellido}` : "Cliente desconocido",
    email: usuario?.email || "",
    telefono: usuario?.telefono || "",
    ubicaciones: (r.Reservas_Ubicaciones || []).map(v => ({
      id_ubicacion: v.id_ubicacion,
      posicion: v.ubicaciones?.posicion,
      id_carpa: v.ubicaciones?.id_carpa
    })),
    balneario_nombre: r.balnearios?.nombre || "",
    fecha_inicio: r.fecha_inicio,
    fecha_salida: r.fecha_salida,
    metodo_pago: r.metodo_pago,
    direccion: r.direccion,
    ciudad: r.ciudad,
    codigo_postal: r.codigo_postal,
    pais_region: r.pais_region,
    precio_total: r.precio_total,
    estado: r.estado // <--- AGREGA ESTA LÍNEA
  };
});

  // 7. Devolver respuesta
  res.json({ reservas });
});


// POST /api/reservas-usuario  (Cliente: ver sus reservas)
app.post('/api/reservas-usuario', async (req, res) => {
  const { auth_id, fechaInicio, fechaFin } = req.body;
  if (!auth_id) {
    return res.status(400).json({ error: "Falta id del usuario." });
  }

  // Traer reservas del usuario con todas sus ubicaciones asociadas
  let query = supabase
    .from("reservas")
    .select(`
      *,
      Reservas_Ubicaciones (
        id_ubicacion,
        ubicaciones (
          id_carpa,
          posicion
        )
      ),
      balnearios (
        nombre
      )
    `)
    .eq("id_usuario", auth_id);

  if (fechaInicio && fechaFin) {
    query = query
      .lte("fecha_inicio", fechaFin)
      .gte("fecha_salida", fechaInicio);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: "Error cargando reservas." });
  }

  // Para cada reserva, devolver todas las ubicaciones asociadas
const reservas = (data || []).map(r => ({
  id_reserva: r.id_reserva,
  ubicaciones: (r.Reservas_Ubicaciones || []).map(v => ({
    id_ubicacion: v.id_ubicacion,
    posicion: v.ubicaciones?.posicion,
    id_carpa: v.ubicaciones?.id_carpa
  })),
  balneario_nombre: r.balnearios?.nombre,
  fecha_inicio: r.fecha_inicio,
  fecha_salida: r.fecha_salida,
  metodo_pago: r.metodo_pago,
  direccion: r.direccion,
  ciudad: r.ciudad,
  codigo_postal: r.codigo_postal,
  pais_region: r.pais_region,
  precio_total: r.precio_total,
  estado: r.estado // <--- AGREGA ESTA LÍNEA
}));

  res.json({ reservas });
});


// GET /api/reserva/ubicacion/:id_ubicacion
app.get('/api/reserva/ubicacion/:id_ubicacion', async (req, res) => {
  const { id_ubicacion } = req.params;
  try {
    // Traer la ubicación y el balneario relacionado
    const { data: ubicacion, error: ubicacionError } = await supabase
      .from("ubicaciones")
      .select("*, balnearios: id_balneario (id_balneario, nombre, direccion, id_ciudad)")
      .eq("id_carpa", id_ubicacion)
      .single();

    if (ubicacionError || !ubicacion) {
      return res.status(404).json({ error: "Ubicación no encontrada." });
    }

    let balneario = ubicacion.balnearios;
    let ciudad_nombre = "";
    if (balneario?.id_ciudad) {
      const { data: ciudad } = await supabase
        .from("ciudades")
        .select("nombre")
        .eq("id_ciudad", balneario.id_ciudad)
        .single();
      ciudad_nombre = ciudad?.nombre || "";
    }
    balneario.ciudad_nombre = ciudad_nombre;

    // Elimina el alias "balnearios" de la respuesta
    delete ubicacion.balnearios;

    res.json({ ubicacion, balneario });
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo datos de la ubicación." });
  }
});

app.post('/api/reserva', async (req, res) => {
  const { 
    id_usuario, 
    id_ubicaciones, // debe ser ARRAY de ids (ej: [2, 4, 7])
    id_balneario, 
    fecha_inicio, 
    fecha_salida, 
    metodo_pago,
    nombre,
    apellido,
    email,
    telefono,
    direccion,
    ciudad,
    codigo_postal,
    pais,
    precio_total
  } = req.body;

  // Validación estricta de datos
  if (!id_usuario || !id_ubicaciones || !Array.isArray(id_ubicaciones) || id_ubicaciones.length === 0 || !id_balneario || !fecha_inicio || !fecha_salida) {
    return res.status(400).json({ error: "Datos incompletos para la reserva." });
  }

  // 1. Chequeo de disponibilidad para CADA ubicación
  try {
    for (const id_ubicacion of id_ubicaciones) {
      // Buscar reservas activas para la ubicación y solapamiento de fechas
      const { data: reservasSolapadas, error: solapadaError } = await supabase
        .from("Reservas_Ubicaciones")
        .select(`
          id_reservas_ubicaciones,
          id_reserva,
          reserva_activa,
          reservas: id_reserva (
            fecha_inicio,
            fecha_salida
          )
        `)
        .eq("id_ubicacion", id_ubicacion)
        .eq("reserva_activa", true);
  
      if (solapadaError) {
        return res.status(500).json({ error: "Error al validar disponibilidad." });
      }
      // Verifica solapamiento de fechas
      const solapada = (reservasSolapadas || []).some(r => {
        const res = r.reservas;
        if (!res) return false;
        return new Date(res.fecha_inicio) <= new Date(fecha_salida) &&
               new Date(res.fecha_salida) >= new Date(fecha_inicio);
      });
      if (solapada) {
        return res.status(400).json({ error: `Ya existe una reserva para la ubicación ${id_ubicacion} en las fechas seleccionadas.` });
      }
    }

    // 2. Recalcular precio total para TODAS las ubicaciones (si no se encuentra, se ignora y no suma)
    let precioCalculado = 0;
    for (const id_ubicacion of id_ubicaciones) {
      // Obtener tipo de ubicación
      const { data: ubicacion, error: ubicacionError } = await supabase
        .from("ubicaciones")
        .select("id_tipo_ubicacion")
        .eq("id_carpa", id_ubicacion)
        .single();
      if (ubicacionError || !ubicacion) {
        return res.status(400).json({ error: `No se encontró la ubicación ${id_ubicacion}` });
      }
      // Obtener precios
      const { data: precios } = await supabase
        .from("precios")
        .select("*")
        .eq("id_balneario", id_balneario)
        .eq("id_tipo_ubicacion", ubicacion.id_tipo_ubicacion);

      if (precios && precios.length > 0) {
        const precio = precios[0];
        const dias = Math.max(1, Math.ceil(
          (new Date(fecha_salida) - new Date(fecha_inicio)) / (1000 * 60 * 60 * 24)
        ));
        let resto = dias;
        const mes = Number(precio.mes);
        const quincena = Number(precio.quincena);
        const semana = Number(precio.semana);
        const dia = Number(precio.dia);

        let cantidadMeses = Math.floor(resto / 30);
        resto = resto % 30;

        let cantidadQuincenas = Math.floor(resto / 15);
        resto = resto % 15;

        let cantidadSemanas = Math.floor(resto / 7);
        resto = resto % 7;

        let cantidadDias = resto;

        precioCalculado += cantidadMeses * mes;
        precioCalculado += cantidadQuincenas * quincena;
        precioCalculado += cantidadSemanas * semana;
        precioCalculado += cantidadDias * dia;
      }
    }

    // Si el frontend mandó uno, priorizo el recalculado; si da cero, uso el enviado por frontend (o cero si tampoco hay)
    const precioTotalFinal = precioCalculado > 0 ? precioCalculado : (precio_total || 0);

    // 3. Insertar en "reservas"
    const { data: reservaInsertada, error: insertError } = await supabase
      .from("reservas")
      .insert({
        id_usuario,
        id_balneario,
        fecha_inicio,
        fecha_salida,
        metodo_pago,
        nombre,
        apellido,
        telefono,
        email,
        direccion,
        ciudad,
        codigo_postal,
        pais_region: pais,
  precio_total: precioTotalFinal,
  estado: 'pendiente'
      })
      .select()
      .single();

    if (insertError || !reservaInsertada) {
      return res.status(500).json({ error: "Error al realizar la reserva." });
    }

    // 4. Insertar los vínculos en "Reservas_Ubicaciones"
    const reservasUbicaciones = id_ubicaciones.map(id_ubicacion => ({
      id_reserva: reservaInsertada.id_reserva,
      id_ubicacion: id_ubicacion,
      reserva_activa: true
    }));

    const { error: vinculoError } = await supabase
      .from("Reservas_Ubicaciones")
      .insert(reservasUbicaciones);

    if (vinculoError) {
      return res.status(500).json({ error: "Reserva creada pero error vinculando ubicaciones." });
    }

    // 5. Marcar ubicaciones como reservadas (opcional pero RECOMENDADO)
    for (const id_ubicacion of id_ubicaciones) {
      await supabase
        .from("ubicaciones")
        .update({ reservado: true })
        .eq("id_carpa", id_ubicacion);
    }

    // 6. Notificar al dueño del balneario por mail
    const { data: balneario, error: balnearioError } = await supabase
      .from("balnearios")
      .select("id_usuario, nombre")
      .eq("id_balneario", id_balneario)
      .single();

    if (!balneario || balnearioError) {
      return res.status(500).json({ error: "Reserva realizada pero no se pudo notificar al balneario (no se encontró el dueño)." });
    }

    const { data: duenio, error: duenioError } = await supabase
      .from("usuarios")
      .select("email")
      .eq("auth_id", balneario.id_usuario)
      .single();

    if (!duenio || duenioError) {
      return res.status(500).json({ error: "Reserva realizada pero no se pudo notificar al dueño del balneario (no se encontró su email)." });
    }

    const { data: usuario, error: usuarioError } = await supabase
      .from("usuarios")
      .select("nombre, apellido, email")
      .eq("auth_id", id_usuario)
      .single();

    // Enviar email con Brevo SMTP usando plantilla completa
    try {
      const emailData = createReservaNotificationEmail({
        id_reserva: reservaInsertada.id_reserva,
        clienteNombre: usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Cliente',
        clienteEmail: usuario?.email || email,
        clienteTelefono: telefono,
        balnearioNombre: balneario.nombre,
        ubicaciones: id_ubicaciones.map((id) => ({ id_ubicacion: id })),
        fechaInicio: fecha_inicio,
        fechaSalida: fecha_salida,
        precioTotal: precioTotalFinal,
        metodoPago: metodo_pago,
        direccion,
        ciudad,
        codigoPostal: codigo_postal,
        pais,
      });
  console.log('[EMAIL] Enviando notificación de reserva a dueño:', duenio.email, 'reserva:', reservaInsertada.id_reserva);
  const info = await sendEmail({ to: duenio.email, ...emailData });
  console.log('[EMAIL] Resultado envío (owner):', { messageId: info?.messageId, accepted: info?.accepted, rejected: info?.rejected });
    } catch (e) {
      console.error('Error enviando email de notificación:', e?.message || e);
    }

    res.status(200).json({ mensaje: "Reserva realizada con éxito. Se notificó al dueño del balneario por mail." });

  } catch (error) {
    console.error("Error en /api/reserva:", error);
    res.status(500).json({ error: "Error al realizar la reserva." });
  }
});





// POST /api/balneario/:id/carpas
app.post('/api/balneario/:id/carpas', async (req, res) => {
  const { id } = req.params;
  const {
    id_tipo_ubicacion, // 1=simple, 2=doble, 3=sombrilla
    cant_sillas,
    cant_mesas,
    cant_reposeras,
    capacidad,
    id_usuario,
    x = 0,
    y = 0
  } = req.body;

  if (!id || !id_tipo_ubicacion || !id_usuario) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }

  // Validación nueva: ¿existe precio para este tipo en este balneario?
  const { data: precioExistente, error: precioError } = await supabase
    .from("precios")
    .select("*")
    .eq("id_balneario", id)
    .eq("id_tipo_ubicacion", id_tipo_ubicacion)
    .maybeSingle();

  if (precioError) {
    return res.status(500).json({ error: "Error validando precio." });
  }
  if (!precioExistente) {
    return res.status(400).json({ error: "Debe cargar los precios para este tipo de ubicación antes de agregar carpas de este tipo." });
  }

  try {
    // Calcular posicion (mayor existente + 1)
    const { data: ubicaciones } = await supabase
      .from("ubicaciones")
      .select("posicion")
      .eq("id_balneario", id)
      .order("posicion", { ascending: false })
      .limit(1);

    const nuevaPosicion = (ubicaciones?.[0]?.posicion || 0) + 1;

    const { data, error } = await supabase
      .from("ubicaciones")
      .insert([{
        id_balneario: id,
        id_tipo_ubicacion,
        cant_sillas,
        cant_mesas,
        cant_reposeras,
        capacidad,
        id_usuario,
        reservado: false,
        posicion: nuevaPosicion,
        x: 0,
        y: 0,
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: "Error agregando carpa o sombrilla." });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Error interno al agregar carpa." });
  }
});

// PUT /api/balneario/:id/precios/:id_tipo_ubicacion
app.put('/api/balneario/:id/precios/:id_tipo_ubicacion', async (req, res) => {
  const { id, id_tipo_ubicacion } = req.params;
  const { dia, semana, quincena, mes } = req.body;
  // Opcional: Chequear autenticación y que sea dueño del balneario

  try {
    const { error } = await supabase
      .from("precios")
      .update({ dia, semana, quincena, mes })
      .eq("id_balneario", id)
      .eq("id_tipo_ubicacion", id_tipo_ubicacion);

    if (error) {
      return res.status(500).json({ error: "Error actualizando precios." });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Error interno." });
  }
});

// === RESEÑAS APIs ===

// Helper para parsear seguro el id de balneario (solo enteros válidos)
function toIntOrNull(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && !isNaN(n) ? n : null;
}

// POST /api/balneario/:id/resenias
app.post('/api/balneario/:id/resenias', async (req, res) => {
  const { id } = req.params;
  const balnearioId = toIntOrNull(id);
  if (balnearioId === null) return res.status(400).json({ error: 'Id de balneario inválido.' });
  const { comentario, estrellas, id_usuario } = req.body;
  if (!comentario?.trim() || !estrellas || !id_usuario) {
    return res.status(400).json({ error: 'Datos incompletos para la reseña.' });
  }
  try {
    // Insertar reseña directamente con el id_balneario
    const { data: nuevaResenia, error: reseniaError } = await supabase
    .from('reseñas')
      .insert([{ comentario, estrellas, id_usuario, id_balneario: balnearioId, likes: 0 }])
      .select()
      .single();

      if (reseniaError || !nuevaResenia) {
        return res.status(500).json({ error: 'Error guardando reseña.' });
      }

      res.json({ ok: true, reseña: nuevaResenia });
    } catch (e) {
      res.status(500).json({ error: 'Error interno guardando reseña.' });
    }
  });

// GET /api/balneario/:id/resenias?usuario_id=XX
app.get('/api/balneario/:id/resenias', async (req, res) => {
  const { id } = req.params;
  const balnearioId = toIntOrNull(id);
  const usuarioId = parseInt(req.query.usuario_id, 10) || null;
  if (balnearioId === null) return res.status(400).json({ error: 'Id de balneario inválido.' });
  try {
    const { data: reseñasData, error: reseñasError } = await supabase
      .from('reseñas')
      .select(`
        id_reseña,
        comentario,
        estrellas,
        id_usuario,
        id_balneario,
        usuarios (
          id_usuario,
          nombre,
          apellido,
          imagen
        )
      `)
      .eq('id_balneario', balnearioId);

    if (reseñasError) return res.status(500).json({ error: 'Error trayendo reseñas.' });

    // Traer todos los likes para estas reseñas
    const idsResenias = reseñasData.map(r => r.id_reseña);
    let likesPorResenia = {};
    let likesDelUsuario = {};
    if (idsResenias.length > 0) {
      // Contar likes por reseña
      const { data: likesData } = await supabase
        .from('likes')
        .select('id_reseña, id_usuario');
      idsResenias.forEach(idResenia => {
        likesPorResenia[idResenia] = 0;
      });
      (likesData || []).forEach(l => {
        likesPorResenia[l.id_reseña] = (likesPorResenia[l.id_reseña] || 0) + 1;
        if (usuarioId && l.id_usuario === usuarioId) {
          likesDelUsuario[l.id_reseña] = true;
        }
      });
    }

    const reseñas = (reseñasData || []).map(r => ({
      id_reseña: r.id_reseña,
      comentario: r.comentario,
      estrellas: r.estrellas,
      id_usuario: r.id_usuario,
      usuario_nombre: r.usuarios?.nombre
        ? r.usuarios.nombre + (r.usuarios.apellido ? " " + r.usuarios.apellido : "")
        : undefined,
      usuario_imagen: r.usuarios?.imagen || null,
      likes: likesPorResenia[r.id_reseña] || 0,
      dioLike: !!likesDelUsuario[r.id_reseña]
    }));

    console.log('Reseñas procesadas:', reseñas);

    res.json({ resenias: reseñas });
  } catch (e) {
    res.status(500).json({ error: 'Error interno trayendo reseñas.' });
  }
});

// POST /api/resenias/:id_reseña/like
app.post('/api/resenias/:id_reseña/like', async (req, res) => {
  const { id_reseña } = req.params;
  const { id_usuario } = req.body;
  if (!id_usuario) return res.status(400).json({ error: 'Falta el id_usuario.' });

  try {
    // Verificar si ya dio like
    const { data: yaLike } = await supabase
      .from('likes')
      .select('*')
      .eq('id_reseña', id_reseña)
      .eq('id_usuario', id_usuario)
      .single();

    if (yaLike) {
      // Si ya dio like, eliminarlo (toggle off)
      await supabase
        .from('likes')
        .delete()
        .eq('id_reseña', id_reseña)
        .eq('id_usuario', id_usuario);
      return res.json({ ok: true, liked: false });
    } else {
      // Si no, insertar like
      await supabase
        .from('likes')
        .insert({ id_usuario, id_reseña });
      return res.json({ ok: true, liked: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error procesando el like.' });
  }
});

/* POST /api/pago/mercadopago
app.post('/api/pago/mercadopago', async (req, res) => {
  const { descripcion, precio, email } = req.body;

  try {
    const preference = {
      items: [
        {
          title: descripcion,
          unit_price: Number(precio),
          quantity: 1,
        }
      ],
      payer: {
        email
      },
      back_urls: {
        success: "http://localhost:3000/pago-exitoso", 
      },
      auto_return: "approved"
    };

    const response = await mercadopago.preferences.create(preference);
    res.json({ init_point: response.body.init_point });
  } catch (error) {
    res.status(500).json({ error: "Error creando preferencia de pago." });
  }
});*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Endpoints para aprobar / rechazar reserva
app.get('/api/reserva/approve/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  const idNum = Number(id_reserva);
  console.log('[RESERVA][APPROVE][GET] id:', id_reserva, 'num:', idNum);
  try {
    // Traer datos de reserva y usuario
    const { data: reserva, error: rErr } = await supabase
      .from('reservas')
      .select('*')
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
      .single();
    if (rErr || !reserva) return res.status(404).send('Reserva no encontrada');

    // Marcar reserva como 'aprobado' y registrar fecha_aprobacion
    const { error: updErr } = await supabaseAdmin
      .from('reservas')
      .update({ estado: 'aprobado', fecha_aprobacion: new Date().toISOString() })
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
    if (updErr) {
      console.error('[RESERVA][APPROVE][GET] Error update:', updErr);
      return res.status(500).send('No se pudo actualizar la reserva');
    }
    console.log('[RESERVA][APPROVE][GET] Update OK');

    // Obtener balneario, dueño y cliente
    const { data: balneario } = await supabase
      .from('balnearios')
      .select('nombre, id_usuario')
      .eq('id_balneario', reserva.id_balneario)
      .single();
    const { data: duenio } = await supabase
      .from('usuarios')
      .select('email')
      .eq('auth_id', balneario?.id_usuario)
      .single();
    const { data: cliente } = await supabase
      .from('usuarios')
      .select('nombre, apellido, email, telefono')
      .eq('auth_id', reserva.id_usuario)
      .single();

    // Email a cliente confirmando
    try {
      const emailData = createApprovalEmail({
        clienteNombre: cliente ? `${cliente.nombre} ${cliente.apellido}` : 'Cliente',
        balnearioNombre: balneario?.nombre || 'Balneario',
        fechaInicio: reserva.fecha_inicio,
        fechaSalida: reserva.fecha_salida,
        precioTotal: reserva.precio_total,
      });
      const destinatario = reserva.email; // usar el email provisto en la reserva
      console.log('[EMAIL] Enviando confirmación de aprobación al cliente (GET):', destinatario, 'reserva:', id_reserva);
      const info = await sendEmail({ to: destinatario, ...emailData });
      console.log('[EMAIL] Resultado envío (cliente approve):', { messageId: info?.messageId, accepted: info?.accepted, rejected: info?.rejected });
    } catch (e) {
      console.error('Error enviando email de aprobación:', e?.message || e);
    }

    // Respuesta simple en navegador
  res.send('La reserva fue aprobada. Se notificó al cliente por email.');
  } catch (e) {
    res.status(500).send('Error procesando aprobación.');
  }
});

app.get('/api/reserva/reject/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  const idNum = Number(id_reserva);
  console.log('[RESERVA][REJECT][GET] id:', id_reserva, 'num:', idNum);
  try {
    const { data: reserva, error: rErr } = await supabase
      .from('reservas')
      .select('*')
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
      .single();
    if (rErr || !reserva) return res.status(404).send('Reserva no encontrada');

    // Marcar estado como 'rechazado' y registrar fecha_rechazo
    const { error: updErr } = await supabaseAdmin
      .from('reservas')
      .update({ estado: 'rechazado', fecha_rechazo: new Date().toISOString() })
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
    if (updErr) {
      console.error('[RESERVA][REJECT][GET] Error update:', updErr);
      return res.status(500).send('No se pudo actualizar la reserva');
    }
    console.log('[RESERVA][REJECT][GET] Update OK');

    // Marcar reserva como no activa en vínculos y liberar ubicaciones
    try {
      const { data: vinculos } = await supabaseAdmin
        .from('Reservas_Ubicaciones')
        .select('id_ubicacion')
  .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
        .eq('reserva_activa', true);
      await supabaseAdmin
        .from('Reservas_Ubicaciones')
        .update({ reserva_activa: false })
  .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
      if (vinculos?.length) {
        const ids = vinculos.map((v) => v.id_ubicacion);
        await supabaseAdmin
          .from('ubicaciones')
          .update({ reservado: false })
          .in('id_carpa', ids);
      }
    } catch {}

    // Obtener balneario y cliente
    const { data: balneario } = await supabase
      .from('balnearios')
      .select('nombre')
      .eq('id_balneario', reserva.id_balneario)
      .single();
    const { data: cliente } = await supabase
      .from('usuarios')
      .select('nombre, apellido, email')
      .eq('auth_id', reserva.id_usuario)
      .single();

    // Email a cliente informando rechazo
    try {
      const emailData = createRejectionEmail({
        clienteNombre: cliente ? `${cliente.nombre} ${cliente.apellido}` : 'Cliente',
        balnearioNombre: balneario?.nombre || 'Balneario',
      });
      const destinatario = reserva.email; // usar el email provisto en la reserva
      console.log('[EMAIL] Enviando notificación de rechazo al cliente (GET):', destinatario, 'reserva:', id_reserva);
      const info = await sendEmail({ to: destinatario, ...emailData });
      console.log('[EMAIL] Resultado envío (cliente reject):', { messageId: info?.messageId, accepted: info?.accepted, rejected: info?.rejected });
    } catch (e) {
      console.error('Error enviando email de rechazo:', e?.message || e);
    }

    res.send('La reserva fue rechazada. Se informó al cliente y se liberaron las ubicaciones.');
  } catch (e) {
    res.status(500).send('Error procesando rechazo.');
  }
});

// Debug: obtener una reserva y su estado
app.get('/api/reserva/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  try {
    const idNum = Number(id_reserva);
    console.log('[DEBUG] GET /api/reserva/:id_reserva ->', id_reserva, 'as number:', idNum);

    let query = supabase.from('reservas').select('*');
    let resp = await query.eq('id_reserva', isNaN(idNum) ? id_reserva : idNum).maybeSingle();
    if ((!resp.data || resp.error) && !isNaN(idNum)) {
      // Fallback: intentar con string si antes fue número
      resp = await query.eq('id_reserva', String(id_reserva)).maybeSingle();
    }
    if (!resp.data) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: 'Error obteniendo reserva' });
  }
});

// Variantes RESTful con PUT para aprobación/rechazo (mismo comportamiento)
app.put('/api/reserva/approve/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  const idNum = Number(id_reserva);
  console.log('[RESERVA][APPROVE][PUT] id:', id_reserva, 'num:', idNum);
  try {
    const { data: reserva, error: rErr } = await supabase
      .from('reservas')
      .select('*')
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
      .single();
    if (rErr || !reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    const { error: updErr } = await supabaseAdmin
      .from('reservas')
      .update({ estado: 'aprobado', fecha_aprobacion: new Date().toISOString() })
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
    if (updErr) return res.status(500).json({ error: 'No se pudo actualizar la reserva' });
    console.log('[RESERVA][APPROVE][PUT] Update OK');

    const { data: balneario } = await supabase
      .from('balnearios')
      .select('nombre, id_usuario')
      .eq('id_balneario', reserva.id_balneario)
      .single();
    const { data: cliente } = await supabase
      .from('usuarios')
      .select('nombre, apellido, email, telefono')
      .eq('auth_id', reserva.id_usuario)
      .single();

    try {
      const emailData = createApprovalEmail({
        clienteNombre: cliente ? `${cliente.nombre} ${cliente.apellido}` : 'Cliente',
        balnearioNombre: balneario?.nombre || 'Balneario',
        fechaInicio: reserva.fecha_inicio,
        fechaSalida: reserva.fecha_salida,
        precioTotal: reserva.precio_total,
      });
      const destinatario = reserva.email; // usar el email provisto en la reserva
      console.log('[EMAIL] Enviando confirmación de aprobación al cliente (PUT):', destinatario, 'reserva:', id_reserva);
      await sendEmail({ to: destinatario, ...emailData });
    } catch (e) {
      console.error('Error enviando email de aprobación (PUT):', e?.message || e);
    }

    res.json({ ok: true, id_reserva, estado: 'aprobado' });
  } catch (e) {
    res.status(500).json({ error: 'Error procesando aprobación' });
  }
});

app.put('/api/reserva/reject/:id_reserva', async (req, res) => {
  const { id_reserva } = req.params;
  const idNum = Number(id_reserva);
  console.log('[RESERVA][REJECT][PUT] id:', id_reserva, 'num:', idNum);
  try {
    const { data: reserva, error: rErr } = await supabase
      .from('reservas')
      .select('*')
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
      .single();
    if (rErr || !reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    const { error: updErr } = await supabaseAdmin
      .from('reservas')
      .update({ estado: 'rechazado', fecha_rechazo: new Date().toISOString() })
      .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
    if (updErr) return res.status(500).json({ error: 'No se pudo actualizar la reserva' });
    console.log('[RESERVA][REJECT][PUT] Update OK');

    // Desactivar vínculos + liberar ubicaciones
    try {
      const { data: vinculos } = await supabaseAdmin
        .from('Reservas_Ubicaciones')
        .select('id_ubicacion')
  .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum)
        .eq('reserva_activa', true);
      await supabaseAdmin
        .from('Reservas_Ubicaciones')
        .update({ reserva_activa: false })
  .eq('id_reserva', isNaN(idNum) ? id_reserva : idNum);
      if (vinculos?.length) {
        const ids = vinculos.map((v) => v.id_ubicacion);
        await supabaseAdmin
          .from('ubicaciones')
          .update({ reservado: false })
          .in('id_carpa', ids);
      }
    } catch {}

    const { data: balneario } = await supabase
      .from('balnearios')
      .select('nombre')
      .eq('id_balneario', reserva.id_balneario)
      .single();
    const { data: cliente } = await supabase
      .from('usuarios')
      .select('nombre, apellido, email')
      .eq('auth_id', reserva.id_usuario)
      .single();

    try {
      const emailData = createRejectionEmail({
        clienteNombre: cliente ? `${cliente.nombre} ${cliente.apellido}` : 'Cliente',
        balnearioNombre: balneario?.nombre || 'Balneario',
      });
      const destinatario = reserva.email; // usar el email provisto en la reserva
      console.log('[EMAIL] Enviando notificación de rechazo al cliente (PUT):', destinatario, 'reserva:', id_reserva);
      await sendEmail({ to: destinatario, ...emailData });
    } catch (e) {
      console.error('Error enviando email de rechazo (PUT):', e?.message || e);
    }

    res.json({ ok: true, id_reserva, estado: 'rechazado' });
  } catch (e) {
    res.status(500).json({ error: 'Error procesando rechazo' });
  }
});