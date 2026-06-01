/**
 * Alert rule management.
 *
 *   POST   /wallets/:id/alerts   create({ walletId, kind, config, ... })
 *   GET    /wallets/:id/alerts   listForWallet(walletId)
 *   GET    /alerts               list()
 *   GET    /alerts/:id           get(id)
 *   PATCH  /alerts/:id           update(id, patch)
 *   DELETE /alerts/:id           delete(id)
 */

import type { HttpTransport } from '../transport.js';
import type {
  AlertRule,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from '../types.js';

export class AlertsClient {
  constructor(private readonly http: HttpTransport) {}

  async create(input: CreateAlertRuleInput): Promise<AlertRule> {
    const { walletId, ...body } = input;
    return this.http.request<AlertRule>(
      'POST',
      `/wallets/${encodeURIComponent(walletId)}/alerts`,
      body
    );
  }

  async listForWallet(walletId: string): Promise<{ rules: AlertRule[]; count: number }> {
    return this.http.request<{ rules: AlertRule[]; count: number }>(
      'GET',
      `/wallets/${encodeURIComponent(walletId)}/alerts`
    );
  }

  async list(): Promise<{ rules: AlertRule[]; count: number }> {
    return this.http.request<{ rules: AlertRule[]; count: number }>('GET', '/alerts');
  }

  async get(ruleId: string): Promise<AlertRule> {
    return this.http.request<AlertRule>('GET', `/alerts/${encodeURIComponent(ruleId)}`);
  }

  async update(ruleId: string, patch: UpdateAlertRuleInput): Promise<AlertRule> {
    return this.http.request<AlertRule>(
      'PATCH',
      `/alerts/${encodeURIComponent(ruleId)}`,
      patch
    );
  }

  async delete(ruleId: string): Promise<void> {
    await this.http.request<void>('DELETE', `/alerts/${encodeURIComponent(ruleId)}`);
  }
}
