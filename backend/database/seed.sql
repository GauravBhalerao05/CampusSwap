-- =============================================================================
-- CampusSwap Initial Database Seed
-- File: backend/database/seed.sql
-- =============================================================================

-- Seed initial categories documented in docs/PROJECT_SPEC.md & docs/API_CONTRACT.md
-- Using INSERT IGNORE so this script is idempotent and safe to run multiple times.
INSERT INTO categories (name, description, is_active) VALUES
('Textbooks', 'Course books, study materials, and reference guides', TRUE),
('Electronics & Gadgets', 'Calculators, lab equipment, cables, and peripherals', TRUE),
('Lab Gear', 'Lab coats, safety goggles, dissection kits, and apparatus', TRUE),
('Furniture', 'Dorm chairs, desks, lamps, and storage organizers', TRUE),
('Bicycles', 'Campus bicycles, locks, helmets, and cycling accessories', TRUE)
ON DUPLICATE KEY UPDATE 
    description = VALUES(description),
    is_active = VALUES(is_active);
