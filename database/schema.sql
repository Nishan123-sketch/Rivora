CREATE DATABASE IF NOT EXISTS weather_flood_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE weather_flood_db;

CREATE TABLE IF NOT EXISTS stations (
 station_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_name VARCHAR(100) NOT NULL,
 latitude DECIMAL(9,6) NOT NULL,
 longitude DECIMAL(9,6) NOT NULL,
 external_station_id VARCHAR(50) NULL,
 data_source VARCHAR(50) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS water_readings (
 reading_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL,
 observed_at DATETIME NOT NULL,
 water_level DECIMAL(8,3) NULL,
 flow_rate DECIMAL(10,3) NULL,
 UNIQUE KEY uq_water_station_time (station_id, observed_at),
 CONSTRAINT fk_water_station FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weather_readings (
 weather_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL,
 observed_at DATETIME NOT NULL,
 rainfall_day DECIMAL(8,2) NULL,
 rainfall DECIMAL(6,2) NULL,
 temperature DECIMAL(4,1) NULL,
 UNIQUE KEY uq_weather_station_time (station_id, observed_at),
 CONSTRAINT fk_weather_station FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weather_forecasts (
 forecast_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL,
 issued_at DATETIME NOT NULL,
 valid_at DATETIME NOT NULL,
 rainfall_forecast DECIMAL(6,2) NULL,
 temperature_forecast DECIMAL(4,1) NULL,
 source VARCHAR(50) NOT NULL,
 UNIQUE KEY uq_forecast_snapshot (station_id, issued_at, valid_at, source),
 CONSTRAINT fk_forecast_station FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS risk_assessments (
 assessment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL,
 assessed_at DATETIME NOT NULL,
 risk_score DECIMAL(5,2) NOT NULL,
 risk_level ENUM('Low','Moderate','High','Severe') NOT NULL,
 method_version VARCHAR(30) NOT NULL,
 input_observed_at DATETIME NOT NULL,
 reason VARCHAR(255) NOT NULL,
 INDEX idx_risk_station_time (station_id, assessed_at),
 CONSTRAINT fk_risk_station FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alerts (
 alert_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 station_id INT UNSIGNED NOT NULL,
 assessment_id BIGINT UNSIGNED NULL,
 alert_type ENUM('weather','flood') NOT NULL,
 severity ENUM('Low','Moderate','High','Severe') NOT NULL,
 message_text VARCHAR(500) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'active',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at DATETIME NULL,
 INDEX idx_alert_station_time (station_id, created_at),
 CONSTRAINT fk_alert_station FOREIGN KEY (station_id) REFERENCES stations(station_id),
 CONSTRAINT fk_alert_assessment FOREIGN KEY (assessment_id) REFERENCES risk_assessments(assessment_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
 user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 email_verified_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_alert_preferences (
 preference_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 station_id INT UNSIGNED NOT NULL,
 weather_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 flood_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 consent_at DATETIME NOT NULL,
 UNIQUE KEY uq_user_station (user_id, station_id),
 INDEX idx_preferences_station (station_id),
 CONSTRAINT fk_preference_user FOREIGN KEY (user_id) REFERENCES users(user_id),
 CONSTRAINT fk_preference_station FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_notifications (
 notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 alert_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
 attempted_at DATETIME NULL,
 sent_at DATETIME NULL,
 provider_reference VARCHAR(150) NULL,
 UNIQUE KEY uq_alert_user (alert_id, user_id),
 INDEX idx_email_status (status),
 CONSTRAINT fk_notification_alert FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
 CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ml_models (
 model_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 version VARCHAR(30) NOT NULL,
 status VARCHAR(20) NOT NULL,
 trained_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ml_predictions (
 prediction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 assessment_id BIGINT UNSIGNED NOT NULL,
 model_id INT UNSIGNED NOT NULL,
 predicted_level ENUM('Low','Moderate','High','Severe') NOT NULL,
 prediction_target VARCHAR(50) NOT NULL,
 horizon_minutes INT UNSIGNED NULL,
 generated_at DATETIME NOT NULL,
 CONSTRAINT fk_prediction_assessment FOREIGN KEY (assessment_id) REFERENCES risk_assessments(assessment_id),
 CONSTRAINT fk_prediction_model FOREIGN KEY (model_id) REFERENCES ml_models(model_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS aws_rainfall_readings (
 aws_station_code VARCHAR(50) NOT NULL,
 observed_at DATETIME NOT NULL,
 hourly_rainfall DECIMAL(8,2) NULL,
 daily_rainfall DECIMAL(8,2) NULL,
 PRIMARY KEY (aws_station_code, observed_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS flood_thresholds (
 station_id INT UNSIGNED PRIMARY KEY,
 advisory_level_m DECIMAL(8,3) NULL,
 warning_level_m DECIMAL(8,3) NULL,
 danger_level_m DECIMAL(8,3) NULL,
 interest_level_m DECIMAL(8,3) NULL,
 caution_level_m DECIMAL(8,3) NULL,
 alert_level_m DECIMAL(8,3) NULL,
 severe_level_m DECIMAL(8,3) NULL,
 verification_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
 verified_at DATETIME NULL,
 source_url VARCHAR(1000) NULL,
 reference_source VARCHAR(255) NULL,
 FOREIGN KEY (station_id) REFERENCES stations(station_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS email_verification_tokens (
 token_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME NOT NULL,
 INDEX idx_token_user (user_id),
 FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB;
