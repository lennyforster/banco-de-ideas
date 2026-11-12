# Banco de ideas — notas para Claude

- Toda la app está en `index.html`.
- **Guía "Cómo se usa"** (botón en la fila del •••): cada vez que se agrega, cambia o se saca una feature, actualizar el array `AYUDA` en `index.html` en el mismo cambio. Lo pidió Lenny.
- Mantener el tono rioplatense y breve en los textos de la interfaz.
- **Cartel de novedades**: SIEMPRE, en cada cambio que se sube, sin excepción, sumar arriba del array `NOVEDADES` en `index.html` una entrada nueva con `n` = el anterior + 1. Nunca reusar ni editar una entrada ya subida: si no sube el `n`, el pop-up no vuelve a salir. Si el cambio solo lo ve Lenny (pruebas como «Versión texto»), la entrada lleva `mio:true` y el cartel le sale solo a él. Lo pidió Lenny: quiere ver el pop-up cada vez que cambiamos algo.
