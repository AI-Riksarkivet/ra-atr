"""OpenTelemetry setup for the Lejonet backend.

Conditionally activated via LEJONET_OTEL_ENABLED=true.
Exports traces, metrics, and logs to an OTLP collector.
"""

import logging
import os

logger = logging.getLogger(__name__)


def setup_telemetry() -> None:
    """Initialize OpenTelemetry if enabled via environment variable."""
    if os.environ.get("LEJONET_OTEL_ENABLED", "").lower() != "true":
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create(
            {
                "service.name": "lejonet-backend",
                "service.version": "0.1.0",
            }
        )

        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        logger.info("OpenTelemetry tracing enabled")
    except ImportError:
        logger.warning("OpenTelemetry packages not installed, skipping telemetry setup")
    except Exception:
        logger.exception("Failed to initialize OpenTelemetry")
