import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config.service";
import { MetricsService } from "../observability/metrics.service";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface ProviderCircuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
  successCount: number;
}

export interface CircuitSnapshot {
  providerId: string;
  state: CircuitState;
  failures: number;
  openedAt: string | null;
  retryAfterMs: number;
}

/**
 * Process-local circuit breaker per provider. This prevents a failing provider
 * from consuming the full timeout budget on every request. Multi-instance
 * deployments should share state through Redis (documented follow-up).
 */
@Injectable()
export class CircuitBreakerService {
  private readonly circuits = new Map<string, ProviderCircuit>();

  constructor(
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  private getCircuit(providerId: string): ProviderCircuit {
    let circuit = this.circuits.get(providerId);
    if (!circuit) {
      circuit = { state: "CLOSED", failures: 0, openedAt: 0, successCount: 0 };
      this.circuits.set(providerId, circuit);
    }
    return circuit;
  }

  canRequest(providerId: string): boolean {
    const circuit = this.getCircuit(providerId);
    if (circuit.state === "CLOSED") return true;
    if (circuit.state === "OPEN") {
      if (Date.now() - circuit.openedAt >= this.config.circuitOpenMs) {
        circuit.state = "HALF_OPEN";
        circuit.successCount = 0;
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(providerId: string): void {
    const circuit = this.getCircuit(providerId);
    circuit.successCount += 1;
    if (circuit.state === "HALF_OPEN" && circuit.successCount >= 2) {
      circuit.state = "CLOSED";
      circuit.failures = 0;
      this.metrics.circuitOpen.set({ provider: providerId }, 0);
    }
    if (circuit.state === "CLOSED") circuit.failures = 0;
  }

  recordFailure(providerId: string): void {
    const circuit = this.getCircuit(providerId);
    circuit.successCount = 0;
    if (circuit.state === "HALF_OPEN") {
      this.open(circuit, providerId);
      return;
    }
    circuit.failures += 1;
    if (circuit.failures >= this.config.circuitFailureThreshold) {
      this.open(circuit, providerId);
    }
  }

  private open(circuit: ProviderCircuit, providerId: string): void {
    circuit.state = "OPEN";
    circuit.openedAt = Date.now();
    this.metrics.circuitOpen.set({ provider: providerId }, 1);
  }

  snapshot(providerIds?: string[]): CircuitSnapshot[] {
    const ids = providerIds ?? [...this.circuits.keys()];
    return ids.map((providerId) => {
      const circuit = this.getCircuit(providerId);
      const retryAfterMs =
        circuit.state === "OPEN"
          ? Math.max(0, this.config.circuitOpenMs - (Date.now() - circuit.openedAt))
          : 0;
      return {
        providerId,
        state: circuit.state,
        failures: circuit.failures,
        openedAt: circuit.openedAt ? new Date(circuit.openedAt).toISOString() : null,
        retryAfterMs,
      };
    });
  }
}
