const pool = require("./db");

const counters = Object.create(null);
const state = {
  connectedAt: null,
  disconnectedAt: null,
  lastMessageAt: null,
};

function increment(name, amount = 1) {
  counters[name] = Number(counters[name] || 0) + amount;
}

function markConnected() {
  state.connectedAt = new Date().toISOString();
  increment("mqtt_connections_total");
}

function markDisconnected() {
  state.disconnectedAt = new Date().toISOString();
  increment("mqtt_disconnects_total");
}

function markMessage() {
  state.lastMessageAt = new Date().toISOString();
  increment("mqtt_messages_received_total");
}

function runtimeSnapshot() {
  return { ...state, counters: { ...counters } };
}

async function operationalSnapshot(mqtt) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::integer
          FROM clinic.hardware_measurement_ack_outbox
         WHERE published_at IS NULL) AS measurement_ack_backlog,
       (SELECT COUNT(*)::integer
          FROM clinic.hardware_measurement_events
         WHERE print_retryable = true
           AND print_status IN ('pending', 'requested', 'failed')) AS print_outbox_backlog,
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (published_at - created_at)) * 1000)::numeric, 2)
          FROM clinic.hardware_measurement_ack_outbox
         WHERE published_at IS NOT NULL
           AND created_at >= now() - interval '1 hour') AS ack_latency_avg_ms,
       (SELECT ROUND(
          100.0 * COUNT(*) FILTER (WHERE print_status = 'failed')
          / NULLIF(COUNT(*) FILTER (WHERE print_attempts > 0), 0), 2)
          FROM clinic.hardware_measurement_events
         WHERE updated_at >= now() - interval '1 hour') AS print_failure_rate_percent`,
  );
  const row = result.rows[0] || {};
  return {
    generated_at: new Date().toISOString(),
    mqtt,
    runtime: runtimeSnapshot(),
    outbox: {
      measurement_ack_backlog: Number(row.measurement_ack_backlog || 0),
      print_backlog: Number(row.print_outbox_backlog || 0),
    },
    latency: {
      measurement_ack_average_ms: row.ack_latency_avg_ms === null ? null : Number(row.ack_latency_avg_ms),
    },
    failure_rate: {
      print_percent_last_hour: row.print_failure_rate_percent === null
        ? null
        : Number(row.print_failure_rate_percent),
    },
  };
}

module.exports = {
  increment,
  markConnected,
  markDisconnected,
  markMessage,
  operationalSnapshot,
  runtimeSnapshot,
};
