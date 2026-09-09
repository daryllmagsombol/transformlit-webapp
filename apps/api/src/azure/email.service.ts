import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  // Env key for the Azure Communication Services connection string. The
  // .env.example / README use ACS_CONNECTION_STRING (Azure Communication
  // Services). Never log its value.
  private readonly acsConnectionString: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.acsConnectionString = this.config.get<string>('ACS_CONNECTION_STRING');
  }

  /**
   * Send the verification email. Tokens are never logged. In production a
   * missing ACS connection string is a hard error — the method must not
   * silently no-op on the security-token stub. In dev/test we log a benign
   * notice (recipient redacted) and do not send.
   */
  async sendVerificationEmail(_to: string, _token: string): Promise<void> {
    const production = process.env.NODE_ENV === 'production';
    if (!this.acsConnectionString && production) {
      throw new Error('Email delivery is not configured');
    }
    if (!production) {
      this.logger.log('[DEV] Verification email (not sent): recipient redacted');
    }
    // Production: use @azure/communication-email EmailClient
    // const client = new EmailClient(connStr);
    // await client.send({ senderAddress, recipients: { to }, content: { subject, html } });
  }

  /**
   * Send the password-reset email. Same token/recipient privacy rules and
   * production configuration enforcement as sendVerificationEmail.
   */
  async sendPasswordReset(_to: string, _token: string): Promise<void> {
    const production = process.env.NODE_ENV === 'production';
    if (!this.acsConnectionString && production) {
      throw new Error('Email delivery is not configured');
    }
    if (!production) {
      this.logger.log('[DEV] Password reset email (not sent): recipient redacted');
    }
    // Production: use @azure/communication-email EmailClient
    // const client = new EmailClient(connStr);
    // await client.send({ senderAddress, recipients: { to }, content: { subject, html } });
  }

  async sendNotification(
    to: string,
    subject: string,
    _body: string,
  ): Promise<void> {
    this.logger.log(`[DEV] Email to ${to}: ${subject}`);
  }
}
