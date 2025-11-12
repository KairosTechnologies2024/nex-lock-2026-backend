-- Create database
CREATE DATABASE nexlock;

-- Connect to the database
\c nexlock;

-- Create geofences table
CREATE TABLE geofences (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    radius INTEGER NOT NULL,
    active BOOLEAN DEFAULT true,
    trucks JSONB DEFAULT '[]'::jsonb,
    color VARCHAR(7) DEFAULT '#FF0000',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trucks table
CREATE TABLE trucks (
    id SERIAL PRIMARY KEY,
    registration VARCHAR(20) UNIQUE NOT NULL,
    model VARCHAR(100),
    capacity DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'active',
    current_lat DECIMAL(10, 8),
    current_lng DECIMAL(11, 8),
    last_seen TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for better performance
CREATE INDEX idx_geofences_active ON geofences(active);
CREATE INDEX idx_trucks_status ON trucks(status);
CREATE INDEX idx_trucks_registration ON trucks(registration);

-- Insert sample data for geofences
INSERT INTO geofences (name, lat, lng, radius, active, trucks, color) VALUES
('Galleria Mall', -26.2041, 28.0473, 500, true, '["DV123", "DV456"]', '#FF6B6B'),
('Toti Center', -26.2141, 28.0573, 300, false, '["DV789"]', '#4ECDC4'),
('Gateway Mall', -26.2241, 28.0673, 400, true, '["DV101", "DV202"]', '#45B7D1');

-- Insert sample data for trucks
INSERT INTO trucks (registration, model, capacity, status, current_lat, current_lng, last_seen) VALUES
('DV829', 'Ford Transit', 1500.00, 'active', -26.2041, 28.0473, CURRENT_TIMESTAMP),
('DV920', 'Mercedes Sprinter', 2000.00, 'active', -26.2141, 28.0573, CURRENT_TIMESTAMP),
('DV789', 'Iveco Daily', 1800.00, 'active', -26.2241, 28.0673, CURRENT_TIMESTAMP),
('DV650', 'Ford Transit', 1500.00, 'active', -26.2341, 28.0773, CURRENT_TIMESTAMP),
('DV922', 'Mercedes Sprinter', 2000.00, 'maintenance', -26.2441, 28.0873, CURRENT_TIMESTAMP),
('DV676', 'Iveco Daily', 1800.00, 'active', -26.2541, 28.0973, CURRENT_TIMESTAMP),
('DV404', 'Ford Transit', 1500.00, 'active', -26.2641, 28.1073, CURRENT_TIMESTAMP),
('DV505', 'Mercedes Sprinter', 2000.00, 'active', -26.2741, 28.1173, CURRENT_TIMESTAMP);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_geofences_updated_at BEFORE UPDATE ON geofences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trucks_updated_at BEFORE UPDATE ON trucks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
