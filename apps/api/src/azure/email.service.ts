import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    this.logger.log(`[DEV] Verification email to ${to}: token=${token}`);
    // Production: use @azure/communication-email EmailClient
    // const client = new EmailClient(connStr);
    // await client.send({ senderAddress, recipients: { to }, content: { subject, html } });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    this.logger.log(`[DEV] Password reset to ${to}: token=${token}`);
  }

  async sendNotification(
    to: string,
    subject: string,
    body: string,
  ): Promise<void> {
    this.logger.log(`[DEV] Email to ${to}: ${subject}`);
  }
}
