import { tool, agent } from "llamaindex";
import { Ollama } from "@llamaindex/ollama";
import { z } from "zod";
import { Busqueda } from "../lib/busqueda.js";

const busqueda = new Busqueda();

const systemPrompt = `
Sos el asistente de Praiar. Escribí en español, breve y conversacional. Sin prefijos ni explicación técnica.

Objetivo: guiar al usuario en 3 pasos y entregar UN link interno navegable.
1) Ciudad → 2) Balneario (hasta 5 opciones con enlace) → 3) Fechas (opcional).
Cuando tengas ciudad y balneario (y si hay fechas), devolvé SOLO el link en la primera línea:
"/balneario/{id}?fi=YYYY-MM-DD&ff=YYYY-MM-DD" (si no hay fechas, sin query). Segunda línea: un resumen corto.

Roles (session): Invitado/Cliente/Dueño. Para Cliente, enlazá siempre "/balneario/{id}" y, si entendés fechas, agregá "?fi=YYYY-MM-DD&ff=YYYY-MM-DD". Atajos: "/ciudades", "/tusbalnearios".

Uso de herramientas: consultá ciudades/balnearios/servicios/disponibilidad según lo que falte. Preguntá sólo lo necesario.

Estilo:
- Si el usuario saluda ("hola", "buenas"), respondé: "Hola, ¿cómo estás? Decime la ciudad a la que querés ir y, si querés, las fechas. Después elegimos el balneario y te doy el link listo."
- Preguntá una cosa por turno: primero ciudad, luego balneario, luego fechas.
- Listas concisas: "- Nombre — /balneario/{id}". Máximo 5 ítems.
- Si no hay resultados, pedí reformular (otra ciudad o quitar filtros).

Extracción de entidades y validación:
- Extraé explícitamente: ciudad, balneario, fechaInicio, fechaFin. Ignorá texto accesorio como "quiero ir a" o "hola que tal".
- La ciudad debe coincidir con alguna del bloque [Ciudades disponibles]. Si no coincide, pedí otra y ofrecé hasta 5 ciudades del bloque.
- Si el usuario escribe un balneario, buscá por nombre y confirmá su ciudad; luego pedí fechas.
- Convertí fechas naturales al formato YYYY-MM-DD. Si hay rango válido (inicio <= fin), usalo. Si no, pedí corrección.
- Si no hay disponibilidad en esas fechas, explicá y ofrecé cambiar fechas o alternativas.

Correcciones del usuario:
- Si el mensaje contiene un marcador [Reset ciudad], olvidá la ciudad entendida y volvé a preguntarla.
- Si contiene [Reset fechas], olvidá fechas y volvé a pedirlas si hacen falta.
- Si contiene [Reset total], olvidá todo y empezá de cero preguntando la ciudad.
`.trim();

const ollamaLLM = new Ollama({
    model: "qwen3:1.7b",
    temperature: 0.9,
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
            const top = balnearios.slice(0, 5);
            return top.map(bal => {
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
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}`).join('\n');
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
            return balnearios.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}`).join('\n');
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
            return balnearios.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}`).join('\n');
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
            return lista.slice(0, 5).map(bal => {
                const qp = (fechaInicio && fechaFin) ? `?fi=${fechaInicio}&ff=${fechaFin}` : "";
                return `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}${qp}`;
            }).join('\n');
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
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}`).join('\n');
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
            return lista.slice(0, 5).map(bal => `- ${bal.nombre} — ${bal.ciudad || "Ciudad"} — /balneario/${bal.id_balneario}`).join('\n');
        } catch (error) {
            return `Error al listar tus balnearios: ${error.message}`;
        }
    },
});

export function crearAgenteBalnearios({ verbose = true } = {}) {
    return agent({
        tools: [
            buscarBalneariosPorCiudadTool,
            listarBalneariosTool,
            listarCiudadesTool,
            filtrarBalneariosPorCiudadYServiciosTool,
            filtrarBalneariosPorServiciosTool, // Nuevo tool agregado
            buscarDisponibilidadTool,
            buscarBalnearioPorNombreTool,
            listarMisBalneariosTool
        ],
        llm: ollamaLLM,
        verbose,
        systemPrompt,
    });
}