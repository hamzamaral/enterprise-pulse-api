import type { PrismaClient } from '@prisma/client';
import { isValidVkn, withVknCheckDigit } from '../src/modules/einvoice/einvoice-rules';

const YEAR = new Date().getFullYear();

/** Registered e-Fatura users among the sample partners; the others receive e-Arşiv invoices. */
const ALIASES: Record<string, string> = {
  'MUS-001': 'urn:mail:defaultpk@bogaziciperakende.com.tr',
  'MUS-003': 'urn:mail:defaultpk@akdenizotelcilik.com.tr',
  'CAR-001': 'urn:mail:defaultpk@karadenizticaret.com.tr',
  'TED-001': 'urn:mail:defaultpk@anadolubilisim.com.tr',
  'TED-002': 'urn:mail:defaultpk@egekirtasiye.com.tr',
  'TED-004': 'urn:mail:defaultpk@marmaraambalaj.com.tr',
};

/** Left with an invalid tax number so the demo shows a GİB rejection. */
const KEEP_INVALID = new Set(['MUS-004']);

/**
 * e-Fatura simulation data: valid VKN check digits for the sample company and partners, mailbox
 * aliases for registered users, the GİB number series and the default settings.
 */
export async function seedEInvoice(prisma: PrismaClient, companyIds: string[]): Promise<void> {
  for (const companyId of companyIds) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.taxNumber && !isValidVkn(company.taxNumber)) {
      await prisma.company.update({
        where: { id: companyId },
        data: { taxNumber: withVknCheckDigit(company.taxNumber) },
      });
    }

    const partners = await prisma.businessPartner.findMany({ where: { companyId } });
    for (const partner of partners) {
      const data: { taxNumber?: string; eInvoiceAlias?: string } = {};
      const tax = partner.taxNumber;
      if (tax?.length === 10 && !isValidVkn(tax) && !KEEP_INVALID.has(partner.code)) {
        data.taxNumber = withVknCheckDigit(tax);
      }
      if (!partner.eInvoiceAlias && ALIASES[partner.code]) {
        data.eInvoiceAlias = ALIASES[partner.code];
      }
      if (Object.keys(data).length) {
        await prisma.businessPartner.update({ where: { id: partner.id }, data });
      }
    }

    for (const [code, name, prefix] of [
      ['E_INVOICE', 'e-Fatura', 'EPF'],
      ['E_ARCHIVE', 'e-Arşiv Fatura', 'EPA'],
    ]) {
      await prisma.numberSequence.upsert({
        where: { companyId_code: { companyId, code } },
        create: { companyId, code, name, prefix, padding: 9, currentYear: YEAR },
        update: {},
      });
    }

    await prisma.setting.upsert({
      where: { companyId_key: { companyId, key: 'einvoice' } },
      create: {
        companyId,
        key: 'einvoice',
        value: {
          senderAlias: `urn:mail:defaultgb@${company.code.toLowerCase()}.enterprisepulse.dev`,
          defaultProfile: 'TICARIFATURA',
          autoSend: false,
        },
      },
      update: {},
    });
  }
}
