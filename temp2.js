import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('app_data.db');
db.all("SELECT * FROM user_inventory WHERE username='name_8221'", (err, rows) => {
    if (err) console.error("ERR:", err);
    console.log("DB RESULT:", JSON.stringify(rows));
});
