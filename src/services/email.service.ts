/**
 * email.service.ts — Nodemailer email service for GeoGyan.
 *
 * Used to send password-setup links to newly approved users.
 * Configure SMTP credentials via environment variables.
 * Falls back to Ethereal test account in development if not configured.
 */

import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter: Transporter;

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    // Production SMTP (configure via .env)
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Development fallback: Ethereal ephemeral test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[Email] Using Ethereal test account:', testAccount.user);
  }

  return transporter;
}

const FROM_ADDRESS = process.env.SMTP_FROM || '"GeoGyan — CMPDI" <noreply@geogyan.cmpdi.gov.in>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Send a password-setup email to an approved access-request applicant.
 * The link contains a plaintext token; the backend stores only the hash.
 */
export async function sendPasswordSetupEmail(
  recipientEmail: string,
  recipientName: string,
  plainToken: string,
): Promise<void> {
  const setupUrl = `${FRONTEND_URL}/setup-password?token=${plainToken}`;
  const t = await getTransporter();

  const info = await t.sendMail({
    from: FROM_ADDRESS,
    to: recipientEmail,
    subject: 'GeoGyan — Your account has been approved. Set up your password.',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #072844; padding: 20px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="color: #fff; margin: 0; font-size: 18px;">GeoGyan — CMPDI Portal</h2>
          <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0; font-size: 13px;">
            Ministry of Coal, Government of India
          </p>
        </div>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 28px 24px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; color: #1e293b;">Dear <strong>${recipientName}</strong>,</p>
          <p style="font-size: 14px; color: #374151; line-height: 1.6;">
            Your access request for the <strong>GeoGyan Intelligence Portal</strong> has been
            <strong style="color: #0F7B3D;">approved</strong>. Please click the button below to
            set up your account password. This link is valid for <strong>48 hours</strong>.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${setupUrl}" 
               style="background: #0B3B60; color: #fff; padding: 12px 28px; border-radius: 6px;
                      text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">
              Set Up My Password
            </a>
          </div>
          <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">
            If the button above does not work, copy and paste this URL into your browser:<br>
            <a href="${setupUrl}" style="color: #0B3B60; word-break: break-all;">${setupUrl}</a>
          </p>
          <p style="font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 20px;">
            This email was sent by GeoGyan — CMPDI Portal. 
            If you did not request this, please ignore this email.
          </p>
        </div>
      </div>
    `,
    text: `Dear ${recipientName},\n\nYour GeoGyan access request has been approved.\n\nSet up your password here (valid 48 hours):\n${setupUrl}\n\n— GeoGyan, CMPDI Portal`,
  });

  if (!process.env.SMTP_HOST) {
    // Log preview URL for Ethereal in development
    console.log('[Email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}

/**
 * Send an access request rejection notice.
 */
export async function sendRejectionEmail(
  recipientEmail: string,
  recipientName: string,
  reviewNote?: string,
): Promise<void> {
  const t = await getTransporter();
  await t.sendMail({
    from: FROM_ADDRESS,
    to: recipientEmail,
    subject: 'GeoGyan — Access Request Update',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #072844; padding: 20px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="color: #fff; margin: 0; font-size: 18px;">GeoGyan — CMPDI Portal</h2>
        </div>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 28px 24px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; color: #1e293b;">Dear <strong>${recipientName}</strong>,</p>
          <p style="font-size: 14px; color: #374151; line-height: 1.6;">
            We regret to inform you that your access request for the <strong>GeoGyan Intelligence Portal</strong>
            could not be approved at this time.
          </p>
          ${reviewNote ? `<p style="font-size: 14px; color: #374151; background: #f9fafb; padding: 12px 16px; border-left: 3px solid #d1d5db; border-radius: 4px;"><strong>Note from administrator:</strong><br>${reviewNote}</p>` : ''}
          <p style="font-size: 14px; color: #374151;">
            For further assistance, please contact your department administrator or write to
            <a href="mailto:helpdesk@cmpdi.gov.in" style="color: #0B3B60;">helpdesk@cmpdi.gov.in</a>.
          </p>
        </div>
      </div>
    `,
    text: `Dear ${recipientName},\n\nYour GeoGyan access request has not been approved.\n${reviewNote ? `Note: ${reviewNote}\n` : ''}Contact helpdesk@cmpdi.gov.in for assistance.\n\n— GeoGyan, CMPDI Portal`,
  });
}
