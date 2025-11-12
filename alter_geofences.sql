-- Add centre_point column of type geography(Point, 4326) if it doesn't exist
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS centre_point geography(Point, 4326);

-- Create or replace function to set centre_point from lat and lng
CREATE OR REPLACE FUNCTION set_centre_point()
RETURNS TRIGGER AS $$
BEGIN
    NEW.centre_point = ST_GeogFromText('POINT(' || NEW.lng || ' ' || NEW.lat || ')');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists and create new one
DROP TRIGGER IF EXISTS trigger_set_centre_point ON geofences;
CREATE TRIGGER trigger_set_centre_point
    BEFORE INSERT OR UPDATE ON geofences
    FOR EACH ROW
    EXECUTE FUNCTION set_centre_point();

-- Update existing rows to populate centre_point
UPDATE geofences SET centre_point = ST_GeogFromText('POINT(' || lng || ' ' || lat || ')') WHERE centre_point IS NULL;
