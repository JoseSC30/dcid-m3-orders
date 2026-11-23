CREATE TABLE
    IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        event_id BIGINT NOT NULL,
        sector_id BIGINT NOT NULL,
        cantidad INT NOT NULL CHECK (cantidad BETWEEN 1 AND 6),
        monto NUMERIC(12, 2) NOT NULL,
        estado TEXT NOT NULL CHECK (
            estado IN ('pendiente', 'pagada', 'rechazada', 'cancelada')
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
    );