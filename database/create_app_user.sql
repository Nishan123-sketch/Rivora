-- Run this in MySQL Workbench as an administrator. Replace the password first.
CREATE USER IF NOT EXISTS 'weather_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON weather_flood_db.* TO 'weather_app'@'localhost';
