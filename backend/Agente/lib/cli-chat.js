import { createInterface } from "readline";

function imprimirMensaje(mensaje) {
  console.log(mensaje);
}

// Formateador de respuestas básico
function formatResponse(response){
  return `📝 Respuesta:\n${response.data.result}`;
}

const mensajeBienvenidaDefault = `
🌊 Asistente de Praiar
--------------------------------------
Decime una ciudad y te muestro los balnearios disponibles.
Escribí 'exit' o presioná Ctrl+C para salir
`

async function empezarChat(elAgente, mensajeBienvenida = ''){
  try {
    imprimirMensaje(mensajeBienvenida || mensajeBienvenidaDefault);
    
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    for await (const pregunta of rl) {
      if (pregunta.toLowerCase() === 'exit') {
        imprimirMensaje("\n👋 ¡Chau! ¡Gracias por usar el asistente!");
        rl.close();
        process.exit(0);
      }

      const start = Date.now();
      const respuesta = await elAgente.run(pregunta);
      const end = Date.now();

      imprimirMensaje(formatResponse(respuesta));
      imprimirMensaje(`\n⏱️  Tiempo de respuesta: ${((end - start) / 1000).toFixed(2)} segundos`);
      imprimirMensaje("\n❓ ¿Qué más querés saber?");
    }
  } catch (error) {
    console.error("\n❌ Ups, algo salió mal:", error);
    process.exit(1);
  }
}

export { empezarChat };
