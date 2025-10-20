import { tool, agent } from "llamaindex";
import { Ollama } from "@llamaindex/ollama";
import { z } from "zod";
import { Busqueda } from "../lib/busqueda.js";

const busqueda = new Busqueda();

const systemPrompt = `
Sos el asistente de Praiar. Objetivo: ayudar a elegir ciudad → balneario → fechas y entregar un link final.

Instrucciones:
- Escribí en español, breve y natural. Un pedido por turno.
- Detectá ciudad, balneario y fechas en el mensaje.
- Usá herramientas para: listar ciudades, listar balnearios por ciudad, buscar balnearios por nombre y verificar disponibilidad con fechas.
- Convertí fechas a YYYY-MM-DD y validá rango (inicio <= fin).
- Cuando haya ciudad + balneario y (si se dio) fechas válidas y disponibles, devolvé SOLO:
  "/balneario/{id}" o "/balneario/{id}?fi=YYYY-MM-DD&ff=YYYY-MM-DD" en la primera línea, y un cierre breve en la segunda.
- Si falta un dato, pedilo puntualmente. No listes ciudades/balnearios salvo que el usuario lo pida o estés en ese paso. Máx. 5 ítems.
- Antes de actuar, llamá a interpretarEntrada(texto) para reconocer intención y entidades; luego usá las demás tools según el paso.
 - Variá el tono y la redacción según el contexto (saludos, "¿todo bien?", etc.), pero mantené siempre el mismo flujo de 3 pasos.
 - Si hay small talk, respondé breve y redirigí con sutileza al siguiente paso necesario del flujo.

Fijate mi agente
Prompt completo para configurar el agente:

Sos un asistente conversacional especializado en ayudar a usuarios a encontrar balnearios turísticos disponibles en una base de datos conectada vía Supabase. Tu trabajo es guiar paso a paso al usuario para que elija:

Una ciudad

Un balneario dentro de esa ciudad

Un rango de fechas disponibles

Solo cuando se confirmen los tres elementos, redirigís al usuario a un link específico del balneario, el cual se genera a partir de los datos en Supabase.

Tu comportamiento debe seguir estas reglas y capacidades:

🧠 Comportamiento y comprensión:

Entendé si el usuario te saluda. Respondé amablemente (ej: "¡Hola! ¿Cómo estás? Decime una ciudad y te muestro los balnearios disponibles.").

Identificá si el usuario menciona una ciudad, un balneario o una fecha. Si dice cosas como "quiero ir a Pinamar", sabé que "Pinamar" es la ciudad.

Si el usuario menciona primero el balneario, detectá a qué ciudad pertenece y pedile la fecha (ej: “Genial, Costa Galana está en Mar del Plata. ¿Qué fechas querés?”).

Detectá si lo que menciona no existe en la base de datos (ciudad, balneario o fecha) y respondé amablemente diciendo algo como: “Lo siento, esa ciudad no la tengo registrada. Estas son las ciudades disponibles: […]”.

Convertí fechas mencionadas por el usuario al formato YYYY-MM-DD, y comparalas contra las fechas disponibles del balneario en la base.

Mantené el estado de la conversación: recordá la ciudad seleccionada momentáneamente, el balneario elegido y luego la fecha, hasta completar los tres pasos.

💬 Flujo Conversacional Ideal:

Inicio del chat:

Saludo amigable inicial automático (ej: “¡Hola! ¿Buscás un balneario para tus vacaciones? Decime una ciudad y te muestro lo que tengo disponible 🙂”)

Cuando el usuario da una ciudad válida:

Guardá esa ciudad como estado.

Respondé con: “Perfecto, estos son los balnearios disponibles en [CIUDAD]: [listado]. Elegí uno y seguimos.”

Cuando da un balneario válido dentro de la ciudad seleccionada:

Guardá el balneario como estado.

Respondé con: “¡Excelente elección! ¿Tenés una fecha en mente? Decime el rango (ej: 2025-12-15 a 2025-12-20) y veo si está disponible.”

Cuando da un rango de fechas válido y disponible:

Si todo es válido, generá el link con redirección:
Ejemplo de respuesta final:
“¡Todo listo! Este es el link a tu balneario: [link-generado]. ¡Que lo disfrutes! 🌊”

🧯 Manejo de errores:

Si el usuario da una ciudad inexistente:
“No encuentro esa ciudad. Estas son las ciudades disponibles: [listado]”

Si elige un balneario que no pertenece a la ciudad ya elegida:
“Ese balneario no está en [CIUDAD]. Estos son los balnearios disponibles allí: [listado]”

Si elige fechas que no están disponibles:
“Uy, no hay disponibilidad en esas fechas para [BALNEARIO]. Probá con otras fechas disponibles: [listado]”

Si intenta saltarse pasos (por ejemplo, dar fecha sin haber elegido ciudad):
“Antes de eso necesito saber en qué ciudad estás buscando. Decime una ciudad para continuar 😊”

🤖 Estilo de respuesta:

Las respuestas deben sonar naturales, cálidas y variadas. No uses siempre el mismo texto. Alterná formas de decir lo mismo.

No uses texto excesivo ni explicaciones muy largas.

NO muestres todos los datos (ciudades, balnearios o fechas) en un solo mensaje largo. Respondé según el contexto del paso en el que está el usuario.

📌 Consideraciones técnicas:

Usá la conexión ya existente a Supabase para obtener:

Listado de ciudades disponibles

Balnearios disponibles por ciudad

Fechas disponibles por balneario

Mantené estado de conversación (ej. qué ciudad o balneario ya se eligió).

Las respuestas deben ajustarse según lo que ya se seleccionó: si ya hay una ciudad, no la vuelvas a pedir. Si ya hay fecha, cerrá con el link.

🧪 Extras:

Si el usuario cambia de idea (por ejemplo, quiere otra ciudad), permití que reinicie ese paso sin romper el flujo.

Ej: “Ok, cambiamos a [nueva ciudad]. Estos son los balnearios ahí: […]”

Permití que el usuario consulte cosas como:

“¿Qué ciudades tenés?”

“¿Qué balnearios hay en Pinamar?”

“¿Qué fechas hay para Costa Galana?”
`.trim();

const ollamaLLM = new Ollama({
    model: "qwen3:1.7b",
    temperature: 0.3,
    timeout: 3 * 60 * 1000,
});

const buscarBalneariosPorCiudadTool = tool({
    name: "buscarBalneariosPorCiudad",
    description: "Usa esta función para encontrar balnearios en una ciudad específica",
    parameters: z.object({
        ciudad: z.string().describe("El nombre de la ciudad a buscar"),
    }),
    execute: async ({ ciudad }) => {
        try {
            const balnearios = await busqueda.buscarBalneariosPorCiudad(ciudad);
            if (!balnearios || balnearios.length === 0) return "No se encontraron balnearios en esa ciudad.";
            return balnearios.slice(0, 5).map(bal => {
                const tel = bal.telefono ? ` — Tel: ${bal.telefono}` : "";
                return `- ${bal.nombre} — Dirección: ${bal.direccion}${tel} — /balneario/${bal.id_balneario}`;
            }).join('\n');
        } catch (error) {
            return `Error al buscar balnearios: ${error.message}`;
        }
    },
});

const listarBalneariosTool = tool({
    name: "listarBalnearios",
    description: "Muestra todos los balnearios y la ciudad donde se encuentran",
    parameters: z.object({}),
    execute: async () => {
        try {
            const lista = await busqueda.listarBalneariosConCiudades();
            if (!lista || lista.length === 0) return "No hay balnearios registrados.";
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`).join('\n');
        } catch (error) {
            return `Error al listar balnearios: ${error.message}`;
        }
    },
});

const listarCiudadesTool = tool({
    name: "listarCiudades",
    description: "Muestra la lista de todas las ciudades disponibles",
    parameters: z.object({}),
    execute: async () => {
        try {
            const ciudades = await busqueda.listarCiudades();
            if (!ciudades || ciudades.length === 0) return "No hay ciudades registradas.";
            // Enlaza al listado de balnearios de cada ciudad
            return ciudades.slice(0, 5).map(ciudad => `- ${ciudad.nombre}`).join('\n');
        } catch (error) {
            return `Error al listar ciudades: ${error.message}`;
        }
    },
});

/**
 * Filtra balnearios por nombre de ciudad y por nombres de servicios (no por ID).
 */
const filtrarBalneariosPorCiudadYServiciosTool = tool({
    name: "filtrarBalneariosPorCiudadYServicios",
    description: "Filtra balnearios que estén en una ciudad (puede ser parcial) y cuenten con TODOS los servicios especificados por nombre (ejemplo: ciudad='Miramar', servicios=['Wi-Fi','Pileta'])",
    parameters: z.object({
        ciudad: z.string().describe("El nombre de la ciudad a buscar (puede ser parcial, puede quedar vacío para no filtrar por ciudad)"),
        servicios: z.array(z.string()).describe("Nombres de los servicios requeridos (puede ser parcial, ej: 'Wi-Fi', 'Pileta')"),
    }),
    execute: async ({ ciudad, servicios }) => {
        try {
            const balnearios = await busqueda.filtrarBalneariosPorCiudadYServicios(ciudad, servicios);
            if (!balnearios || balnearios.length === 0) return "No se encontraron balnearios en esa ciudad con esos servicios.";
            return balnearios.slice(0, 5).map(bal => 
                `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`
            ).join('\n');
        } catch (error) {
            return `Error al filtrar balnearios: ${error.message}`;
        }
    },
});

/**
 * NUEVO: Filtra balnearios solo por servicios (por nombre, no por ID), SIN filtrar por ciudad.
 * Recibe: servicios (array de string, nombres/parciales de servicios, ej: ["Wi-Fi", "Pileta"])
 */
const filtrarBalneariosPorServiciosTool = tool({
    name: "filtrarBalneariosPorServicios",
    description: "Filtra balnearios que cuenten con TODOS los servicios especificados por nombre (ejemplo: servicios=['Wi-Fi','Pileta']). No filtra por ciudad.",
    parameters: z.object({
        servicios: z.array(z.string()).describe("Nombres de los servicios requeridos (puede ser parcial, ej: 'Wi-Fi', 'Pileta')"),
    }),
    execute: async ({ servicios }) => {
        try {
            // Llama con ciudad vacía para que solo filtre por servicios
            const balnearios = await busqueda.filtrarBalneariosPorCiudadYServicios("", servicios);
            if (!balnearios || balnearios.length === 0) return "No se encontraron balnearios con esos servicios.";
            return balnearios.slice(0, 5).map(bal => 
                `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`
            ).join('\n');
        } catch (error) {
            return `Error al filtrar balnearios: ${error.message}`;
        }
    },
});

// Busca balnearios disponibles en un rango de fechas opcional, combinable con ciudad y/o servicios
const buscarDisponibilidadTool = tool({
    name: "buscarDisponibilidad",
    description: "Lista balnearios disponibles. Filtros opcionales: ciudad (parcial), servicios (debe cumplir TODOS), fechas (inicio y salida en formato YYYY-MM-DD). Si no se envían fechas, no filtra por disponibilidad.",
    parameters: z.object({
        ciudad: z.string().default("").describe("Nombre parcial de ciudad. Opcional."),
        servicios: z.array(z.string()).default([]).describe("Nombres de servicios requeridos. Opcional."),
        fechaInicio: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional().describe("YYYY-MM-DD. Opcional, usar junto con fechaFin."),
        fechaFin: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional().describe("YYYY-MM-DD. Opcional, usar junto con fechaInicio."),
    }),
    execute: async ({ ciudad = "", servicios = [], fechaInicio, fechaFin }) => {
        try {
            if ((fechaInicio && !fechaFin) || (!fechaInicio && fechaFin)) {
                return "Para filtrar por disponibilidad, enviá ambas fechas: 'fechaInicio' y 'fechaFin' (YYYY-MM-DD).";
            }

            const lista = await busqueda.listarBalneariosDisponibles({ ciudad, servicios, fechaInicio, fechaFin });
            if (!lista || lista.length === 0) {
                return "No hay balnearios que cumplan con esos filtros.";
            }
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`).join('\n');
        } catch (error) {
            return `Error al buscar disponibilidad: ${error.message}`;
        }
    },
});

// Nuevo: buscar balnearios por nombre (parcial)
const buscarBalnearioPorNombreTool = tool({
    name: "buscarBalnearioPorNombre",
    description: "Busca balnearios por nombre (parcial) y devuelve enlaces /balneario/{id}",
    parameters: z.object({
        nombre: z.string().describe("Nombre o parte del nombre del balneario"),
    }),
    execute: async ({ nombre }) => {
        try {
            const lista = await busqueda.buscarBalneariosPorNombre(nombre);
            if (!lista || lista.length === 0) return "No se encontraron balnearios con ese nombre.";
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`).join('\n');
        } catch (error) {
            return `Error al buscar por nombre: ${error.message}`;
        }
    },
});

// Nuevo: listar balnearios del dueño autenticado
const listarMisBalneariosTool = tool({
    name: "listarMisBalnearios",
    description: "Lista los balnearios del dueño autenticado (usa session.auth_id)",
    parameters: z.object({
        auth_id: z.string().describe("auth_id del usuario dueño"),
    }),
    execute: async ({ auth_id }) => {
        try {
            const lista = await busqueda.listarBalneariosDelDueno(auth_id);
            if (!lista || lista.length === 0) return "No tenés balnearios aún. Andá a /tusbalnearios para crear el primero.";
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — ${bal.direccion} — /balneario/${bal.id_balneario}`).join('\n');
        } catch (error) {
            return `Error al listar tus balnearios: ${error.message}`;
        }
    },
});
const verificarDisponibilidadDeBalnearioTool = tool({
    name: "verificarDisponibilidadDeBalneario",
    description: "Devuelve cuántas ubicaciones libres tiene un balneario en un rango (YYYY-MM-DD)",
    parameters: z.object({
        id_balneario: z.number().describe("ID del balneario"),
        fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha inicio YYYY-MM-DD"),
        fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha fin YYYY-MM-DD"),
    }),
    execute: async ({ id_balneario, fechaInicio, fechaFin }) => {
        try {
            const resultado = await busqueda.verificarDisponibilidadDeBalneario(id_balneario, fechaInicio, fechaFin);
            return JSON.stringify(resultado);
        } catch (error) {
            return `Error al verificar disponibilidad: ${error.message}`;
        }
    },
});

// Tool NLU: interpretar intención y entidades de un texto libre
const interpretarEntradaTool = tool({
    name: "interpretarEntrada",
    description: "Interpreta intención (listar_ciudades, elegir_ciudad, elegir_balneario, dar_fechas, saludo, ayuda) y entidades {ciudad, balneario, fi, ff}",
    parameters: z.object({
        texto: z.string().describe("Mensaje del usuario en lenguaje natural")
    }),
    execute: async ({ texto }) => {
        const raw = (texto || '').toString();
        const lower = raw.toLowerCase();
        const result = { intent: null, ciudad: null, balneario: null, fi: null, ff: null };
        // saludo
        if (/^(hola|buenas|hello|hey|qué tal|como andas|como estas)[!.\s]*$/i.test(raw.trim())) {
            result.intent = 'saludo';
        }
        // listar ciudades
        if (/\b(ciudades|lista de ciudades|listar ciudades)\b/i.test(raw)) {
            result.intent = 'listar_ciudades';
        }
        // rango ISO
        const iso = raw.match(/(\d{4}-\d{2}-\d{2}).{0,20}(\d{4}-\d{2}-\d{2})/);
        if (iso) {
            result.fi = iso[1];
            result.ff = iso[2];
            result.intent = result.intent || 'dar_fechas';
        }
        // dd/mm/yyyy
        if (!result.fi || !result.ff) {
            const dmy = raw.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}).{0,20}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
            if (dmy) {
                const toIso = (s) => {
                    const [d, m, y] = s.replace(/-/g,'/').split('/').map(x=>x.padStart(2,'0'));
                    return `${y}-${m}-${d}`;
                };
                result.fi = toIso(dmy[1]);
                result.ff = toIso(dmy[2]);
                result.intent = result.intent || 'dar_fechas';
            }
        }
        // español: "9 de noviembre al 12 de noviembre de 2025" o "del 9 de nov al 12 de nov 2025"
        if (!result.fi || !result.ff) {
            const meses = {
                'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
                'julio':'07','agosto':'08','septiembre':'09','setiembre':'09','octubre':'10','noviembre':'11','diciembre':'12',
                'ene':'01','feb':'02','mar':'03','abr':'04','may':'05','jun':'06','jul':'07','ago':'08','sep':'09','oct':'10','nov':'11','dic':'12'
            };
            const monthRegex = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)';
            const rgx = new RegExp(`(?:del?\s*)?(\\d{1,2})\s*de\s*${monthRegex}(?:\s*de\s*(\\d{4}))?[^\\d]{0,20}(?:al\s*)?(\\d{1,2})\s*de\s*${monthRegex}(?:\s*de\s*(\\d{4}))?`, 'i');
            const m = lower.match(rgx);
            if (m) {
                const d1 = String(m[1]).padStart(2,'0');
                const mo1 = meses[m[2]];
                const y1 = m[3] ? m[3] : null;
                const d2 = String(m[4]).padStart(2,'0');
                const mo2 = meses[m[5]];
                const y2 = m[6] ? m[6] : null;
                const year = y2 || y1 || String(new Date().getFullYear());
                const fiYear = y1 || year;
                const ffYear = y2 || year;
                if (mo1 && mo2) {
                    result.fi = `${fiYear}-${mo1}-${d1}`;
                    result.ff = `${ffYear}-${mo2}-${d2}`;
                    result.intent = result.intent || 'dar_fechas';
                }
            }
        }
        // heurística básica para capturar posible ciudad/balneario por palabras clave
        if (/\b(en|a|para)\s+([a-záéíóúñ\s]+)$/i.test(lower)) {
            const match = lower.match(/\b(en|a|para)\s+([a-záéíóúñ\s]+)$/i);
            if (match) {
                result.ciudad = match[2].trim();
                result.intent = result.intent || 'elegir_ciudad';
            }
        }
        return JSON.stringify(result);
    }
});

// Tool para construir el link final
const generarLinkFinalTool = tool({
    name: "generarLinkFinal",
    description: "Construye el link final de balneario con fechas opcionales",
    parameters: z.object({
        id_balneario: z.number().describe("ID del balneario"),
        fi: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    execute: async ({ id_balneario, fi, ff }) => {
        const qp = (fi && ff) ? `?fi=${fi}&ff=${ff}` : '';
        return `/balneario/${id_balneario}${qp}`;
    }
});

export function crearAgenteBalnearios({ verbose = true } = {}) {
    return agent({
        tools: [
            interpretarEntradaTool,
            buscarBalneariosPorCiudadTool,
            listarBalneariosTool,
            listarCiudadesTool,
            verificarDisponibilidadDeBalnearioTool,
            filtrarBalneariosPorCiudadYServiciosTool,
            filtrarBalneariosPorServiciosTool,
            buscarDisponibilidadTool,
            buscarBalnearioPorNombreTool,
            listarMisBalneariosTool,
            generarLinkFinalTool
        ],
        llm: ollamaLLM,
        verbose,
        systemPrompt,
    });
}