import { supabase } from '../../supabaseClient.js';

class Busqueda {
  // Busca balnearios según el nombre de la ciudad (búsqueda parcial, case insensitive)
  async buscarBalneariosPorCiudad(nombreCiudad) {
    // Agregar % para búsqueda parcial (contains)
    const { data: ciudades, error: errorCiudad } = await supabase
      .from('ciudades')
      .select('id_ciudad')
      .ilike('nombre', `%${nombreCiudad}%`);

    if (errorCiudad) throw errorCiudad;
    if (!ciudades || ciudades.length === 0) return [];

    // Tomamos la primera ciudad que coincida
    const idCiudad = ciudades[0].id_ciudad;

    // Busca balnearios con ese id_ciudad
    const { data: balnearios, error: errorBalnearios } = await supabase
      .from('balnearios')
      .select('id_balneario, nombre, direccion, telefono, imagen, id_ciudad')
      .eq('id_ciudad', idCiudad);

    if (errorBalnearios) throw errorBalnearios;
    return balnearios || [];
  }

  // Lista todos los balnearios con info de ciudad
  async listarBalneariosConCiudades() {
    const { data, error } = await supabase
      .from('balnearios')
      .select(`
        id_balneario,
        nombre,
        direccion,
        telefono,
        imagen,
        id_ciudad,
        ciudades (
          id_ciudad,
          nombre,
          img
        )
      `);

    if (error) throw error;

    return (data || []).map(balneario => ({
      id_balneario: balneario.id_balneario,
      nombre: balneario.nombre,
      direccion: balneario.direccion,
      telefono: balneario.telefono,
      imagen: balneario.imagen,
      ciudad: balneario.ciudades ? balneario.ciudades.nombre : null,
      ciudad_img: balneario.ciudades ? balneario.ciudades.img : null,
    }));
  }

  // Busca balnearios por nombre (búsqueda parcial) y devuelve con datos de ciudad
  async buscarBalneariosPorNombre(nombreParcial) {
    const termino = (nombreParcial || '').trim();
    if (!termino) return [];

    const { data, error } = await supabase
      .from('balnearios')
      .select(`
        id_balneario,
        nombre,
        direccion,
        telefono,
        imagen,
        id_ciudad,
        ciudades (
          id_ciudad,
          nombre,
          img
        )
      `)
      .ilike('nombre', `%${termino}%`);

    if (error) throw error;

    return (data || []).map(balneario => ({
      id_balneario: balneario.id_balneario,
      nombre: balneario.nombre,
      direccion: balneario.direccion,
      telefono: balneario.telefono,
      imagen: balneario.imagen,
      ciudad: balneario.ciudades ? balneario.ciudades.nombre : null,
      ciudad_img: balneario.ciudades ? balneario.ciudades.img : null,
    }));
  }

  // Lista balnearios pertenecientes a un usuario (dueño) por auth_id
  async listarBalneariosDelDueno(authId) {
    const id = (authId || '').trim();
    if (!id) return [];

    const { data, error } = await supabase
      .from('balnearios')
      .select(`
        id_balneario,
        nombre,
        direccion,
        telefono,
        imagen,
        id_ciudad,
        ciudades (
          id_ciudad,
          nombre,
          img
        )
      `)
      .eq('id_usuario', id);

    if (error) throw error;

    return (data || []).map(balneario => ({
      id_balneario: balneario.id_balneario,
      nombre: balneario.nombre,
      direccion: balneario.direccion,
      telefono: balneario.telefono,
      imagen: balneario.imagen,
      ciudad: balneario.ciudades ? balneario.ciudades.nombre : null,
      ciudad_img: balneario.ciudades ? balneario.ciudades.img : null,
    }));
  }

  // Lista todas las ciudades
  async listarCiudades() {
    const { data, error } = await supabase
      .from('ciudades')
      .select('id_ciudad, nombre, img');

    if (error) throw error;
    return data || [];
  }

  /**
   * Filtra balnearios por ciudad y por servicios (por NOMBRE de servicio, no por id).
   * Devuelve los balnearios que estén en la ciudad buscada y tengan TODOS los servicios indicados.
   * @param {string} nombreCiudad - Nombre (o parte del nombre) de la ciudad. Si es null, ignora filtro de ciudad.
   * @param {Array<string>} nombresServicios - Array de nombres de servicios a filtrar.
   * @returns {Promise<Array>} lista de balnearios que cumplen con los servicios y ciudad
   */
  async filtrarBalneariosPorCiudadYServicios(nombreCiudad, nombresServicios) {
    if (!Array.isArray(nombresServicios) || nombresServicios.length === 0) return [];

    // 1. Buscar ids de los servicios por sus nombres (case insensitive, match parcial)
    const { data: servicios, error: errorServicios } = await supabase
      .from('servicios')
      .select('id_servicio, nombre')
      .or(
        nombresServicios
          .map(nom => `nombre.ilike.%${nom}%`)
          .join(',')
      );

    if (errorServicios) throw errorServicios;
    if (!servicios || servicios.length < nombresServicios.length) {
      // No se encontraron todos los servicios buscados
      return [];
    }

    const idsServicios = servicios.map(s => s.id_servicio);

    // 2. Si hay filtro de ciudad, buscar id_ciudad
    let idCiudad = null;
    if (nombreCiudad && nombreCiudad.trim() !== '') {
      const { data: ciudades, error: errorCiudad } = await supabase
        .from('ciudades')
        .select('id_ciudad')
        .ilike('nombre', `%${nombreCiudad}%`);

      if (errorCiudad) throw errorCiudad;
      if (!ciudades || ciudades.length === 0) return [];
      idCiudad = ciudades[0].id_ciudad;
    }

    // 3. Buscar balnearios_servicios que tengan esos servicios
    const { data: bs, error: errorBS } = await supabase
      .from('balnearios_servicios')
      .select('id_balneario, id_servicio')
      .in('id_servicio', idsServicios);

    if (errorBS) throw errorBS;
    if (!bs || bs.length === 0) return [];

    // 4. Contar ocurrencias de balneario: debe tener TODOS los servicios pedidos
    const balnearioCount = {};
    bs.forEach(row => {
      balnearioCount[row.id_balneario] = (balnearioCount[row.id_balneario] || 0) + 1;
    });

    const balneariosMatch = Object.entries(balnearioCount)
      .filter(([_, count]) => count === idsServicios.length)
      .map(([id]) => parseInt(id));

    if (balneariosMatch.length === 0) return [];

    // 5. Traer info de los balnearios filtrados (y de la ciudad si corresponde)
    let query = supabase
      .from('balnearios')
      .select(`
        id_balneario,
        nombre,
        direccion,
        telefono,
        imagen,
        id_ciudad,
        ciudades (
          id_ciudad,
          nombre,
          img
        )
      `)
      .in('id_balneario', balneariosMatch);

    if (idCiudad) {
      query = query.eq('id_ciudad', idCiudad);
    }

    const { data: balnearios, error: errorBal } = await query;
    if (errorBal) throw errorBal;

    return (balnearios || []).map(balneario => ({
      id_balneario: balneario.id_balneario,
      nombre: balneario.nombre,
      direccion: balneario.direccion,
      telefono: balneario.telefono,
      imagen: balneario.imagen,
      ciudad: balneario.ciudades ? balneario.ciudades.nombre : null,
      ciudad_img: balneario.ciudades ? balneario.ciudades.img : null,
    }));
  }

  /**
   * Lista balnearios disponibles con filtros opcionales de ciudad, servicios y rango de fechas.
   * Si se proveen fechaInicio y fechaFin (YYYY-MM-DD), devuelve solo los balnearios que
   * tengan al menos una ubicación libre en ese rango (sin reservas solapadas).
   * - ciudad: string opcional (búsqueda parcial)
   * - servicios: Array<string> opcional (debe cumplir TODOS)
   * - fechaInicio, fechaFin: string opcional en formato YYYY-MM-DD (ambos o ninguno)
   */
  async listarBalneariosDisponibles({ ciudad = '', servicios = [], fechaInicio = null, fechaFin = null } = {}) {
    // 1) Obtener candidatos por ciudad/servicios si corresponde
    let candidatos = [];
    const tieneCiudad = typeof ciudad === 'string' && ciudad.trim() !== '';
    const tieneServicios = Array.isArray(servicios) && servicios.length > 0;

    if (tieneCiudad && tieneServicios) {
      candidatos = await this.filtrarBalneariosPorCiudadYServicios(ciudad, servicios);
    } else if (tieneCiudad) {
      const porCiudad = await this.buscarBalneariosPorCiudad(ciudad);
      // Normalizar a la misma forma de salida que listarBalneariosConCiudades
      const ids = porCiudad.map(b => b.id_balneario);
      if (ids.length === 0) return [];
      const { data: balnearios, error } = await supabase
        .from('balnearios')
        .select(`
          id_balneario,
          nombre,
          direccion,
          telefono,
          imagen,
          id_ciudad,
          ciudades (
            id_ciudad,
            nombre,
            img
          )
        `)
        .in('id_balneario', ids);
      if (error) throw error;
      candidatos = (balnearios || []).map(balneario => ({
        id_balneario: balneario.id_balneario,
        nombre: balneario.nombre,
        direccion: balneario.direccion,
        telefono: balneario.telefono,
        imagen: balneario.imagen,
        ciudad: balneario.ciudades ? balneario.ciudades.nombre : null,
        ciudad_img: balneario.ciudades ? balneario.ciudades.img : null,
      }));
    } else if (tieneServicios) {
      candidatos = await this.filtrarBalneariosPorCiudadYServicios('', servicios);
    } else {
      candidatos = await this.listarBalneariosConCiudades();
    }

    if (!fechaInicio || !fechaFin) {
      return candidatos;
    }

    // 2) Filtrar por disponibilidad en el rango indicado
    const idsBalnearios = candidatos.map(b => b.id_balneario);
    if (idsBalnearios.length === 0) return [];

    // 2.a) Traer ubicaciones de estos balnearios
    const { data: ubicaciones, error: ubicacionesError } = await supabase
      .from('ubicaciones')
      .select('id_ubicacion, id_balneario')
      .in('id_balneario', idsBalnearios);
    if (ubicacionesError) throw ubicacionesError;

    const ubicacionesPorBalneario = new Map();
    (ubicaciones || []).forEach(u => {
      if (!ubicacionesPorBalneario.has(u.id_balneario)) {
        ubicacionesPorBalneario.set(u.id_balneario, []);
      }
      ubicacionesPorBalneario.get(u.id_balneario).push(u.id_ubicacion);
    });

    // 2.b) Traer reservas solapadas del rango para esos balnearios
    let reservasQuery = supabase
      .from('reservas')
      .select('id_balneario, Reservas_Ubicaciones ( id_ubicacion ), fecha_inicio, fecha_salida')
      .in('id_balneario', idsBalnearios)
      .lte('fecha_inicio', fechaFin)
      .gte('fecha_salida', fechaInicio);
    const { data: reservas, error: reservasError } = await reservasQuery;
    if (reservasError) throw reservasError;

    const ubicacionesReservadas = new Set();
    (reservas || []).forEach(r => {
      (r.Reservas_Ubicaciones || []).forEach(v => {
        if (v?.id_ubicacion != null) {
          ubicacionesReservadas.add(v.id_ubicacion);
        }
      });
    });

    // 2.c) Quedarse con balnearios que tengan al menos una ubicación no reservada
    const resultado = candidatos
      .map(b => {
        const todas = ubicacionesPorBalneario.get(b.id_balneario) || [];
        if (todas.length === 0) {
          return { ...b, disponibles: 0 };
        }
        const libres = todas.filter(idU => !ubicacionesReservadas.has(idU));
        return { ...b, disponibles: libres.length };
      })
      .filter(b => b.disponibles > 0);

    return resultado;
  }
  async verificarDisponibilidadDeBalneario(idBalneario, fechaInicio, fechaFin) {
    const id = parseInt(idBalneario);
    if (!id || !fechaInicio || !fechaFin) return { disponibles: 0 };

    // Traer ubicaciones del balneario
    const { data: ubicaciones, error: ubicacionesError } = await supabase
      .from('ubicaciones')
      .select('id_ubicacion')
      .eq('id_balneario', id);
    if (ubicacionesError) throw ubicacionesError;

    const todasUbicaciones = (ubicaciones || []).map(u => u.id_ubicacion);
    if (todasUbicaciones.length === 0) return { disponibles: 0 };

    // Reservas solapadas dentro del rango
    const { data: reservas, error: reservasError } = await supabase
      .from('reservas')
      .select('Reservas_Ubicaciones ( id_ubicacion ), fecha_inicio, fecha_salida')
      .eq('id_balneario', id)
      .lte('fecha_inicio', fechaFin)
      .gte('fecha_salida', fechaInicio);
    if (reservasError) throw reservasError;

    const reservadas = new Set();
    (reservas || []).forEach(r => {
      (r.Reservas_Ubicaciones || []).forEach(v => {
        if (v?.id_ubicacion != null) reservadas.add(v.id_ubicacion);
      });
    });

    const libres = todasUbicaciones.filter(idU => !reservadas.has(idU));
    return { disponibles: libres.length };
  }
}


export { Busqueda };