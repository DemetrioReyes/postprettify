# PostPrettify

Un gestor visual de PostgreSQL que vive dentro de VS Code. Sin apps extra, sin cambiar de ventana — abres el panel y trabajas con tu base de datos directo desde el editor.

> **En desarrollo.** Lo estoy construyendo para mi propio flujo de trabajo pero lo hago público por si a alguien más le sirve. Pueden haber bugs. Cualquier PR es bienvenido.

---

## Qué hace

Te conectas a una base de datos Postgres y tienes una interfaz completa para explorarla y gestionarla sin tener que escribir SQL para todo.

**Conexiones**
- Guarda múltiples conexiones (las credenciales van al SecretStorage de VS Code, no en texto plano)
- Reconecta conexiones guardadas con un clic
- Sidebar redimensionable con el árbol de conexiones completo

**Exploración de datos**
- Abre cualquier tabla y ve sus datos en un grid
- Paginación, ordenamiento y filtros por columna del lado del servidor
- Edición inline — haces clic en una celda, cambias el valor, guardas
- Agrega y elimina filas
- Exporta datos como CSV o JSON
- Importa filas desde un archivo CSV
- Copia filas como JSON o como un INSERT listo para ejecutar

**Gestión de esquema**
- Crea y elimina tablas con un wizard
- Modifica columnas (agregar, eliminar, renombrar, cambiar tipo, nullability, defaults, unique)
- Gestiona índices (crear, eliminar, ver definición)
- Crea y elimina schemas
- Crea y elimina vistas
- Elimina tablas y vistas directo desde el sidebar

**Editor SQL**
- Editor completo con sintaxis PostgreSQL (CodeMirror)
- Autocompletado con los nombres de tus tablas y columnas
- Ejecuta queries con Cmd/Ctrl+Enter
- EXPLAIN ANALYZE con Cmd/Ctrl+Shift+Enter (corre dentro de una transacción para que no mute nada accidentalmente)
- Historial de queries que persiste entre sesiones
- Exporta resultados como CSV o JSON

**Diagrama ERD**
- Diagrama entidad-relación visual de toda la base de datos
- Arrastra desde el handle de una tabla hasta otra para crear una foreign key — un diálogo te deja elegir exactamente qué columnas
- Haz clic en cualquier línea de relación para eliminar esa foreign key
- Zoom, pan, minimapa

**Visor de funciones**
- Navega todas las funciones y procedimientos de la base de datos
- Filtra por nombre, schema o tipo
- Ve la definición completa del source

---

## Stack

- **Extension host:** Node.js + TypeScript + `pg`
- **WebView UI:** React + TypeScript, bundleado con Vite
- **Estado:** Zustand
- **Data grid:** TanStack Table
- **ERD:** React Flow
- **Editor SQL:** CodeMirror 6
- **Credenciales:** VS Code SecretStorage API

---

## Contribuir

Está en etapa temprana así que hay bastante por mejorar. Si quieres arreglar algo o agregar un feature, abre un PR — lo reviso.

Cosas que sé que necesitan trabajo:
- No hay suite de tests todavía
- El layout del ERD podría ser más inteligente (auto-acomodar por relaciones FK)
- Soporte para MySQL / SQLite sería bueno eventualmente
- La extensión todavía no está publicada en el marketplace

---

## Autor

Demetrio Reyes — construyendo cosas que realmente necesito.
