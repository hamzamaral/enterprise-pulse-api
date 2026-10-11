import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('EnterprisePulse ERP API')
    .setDescription(
      'Modular ERP backend. Send `Authorization: Bearer <accessToken>` and optionally `x-company-id` / `x-branch-id` to select the active company and branch.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters(
      { name: 'x-company-id', in: 'header', required: false, schema: { type: 'string' } },
      { name: 'x-branch-id', in: 'header', required: false, schema: { type: 'string' } },
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    // Stable operation ids -> readable generated client names (e.g. usersFindAll)
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '').replace(/^./, (c) => c.toLowerCase())}${methodKey.replace(/^./, (c) => c.toUpperCase())}`,
  });
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
