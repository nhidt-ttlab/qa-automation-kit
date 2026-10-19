import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorFilter } from './common/api-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new ApiErrorFilter());

  // CORS for local development
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    // The web app calls the API cross-origin, and browsers hide non-safelisted response headers
    // from scripts unless they are exposed -- without this the CSV exports cannot read the
    // server's dated filename and every download falls back to a generic name.
    exposedHeaders: ['Content-Disposition'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${process.env.REPORTING_TITLE || 'QA Reporting'} API`)
    .setDescription('API for the regression test reporting workspace')
    .setVersion('0.1.0')
    .addTag('dashboard')
    .addTag('runs')
    .addTag('testcases')
    .addTag('defects')
    .addTag('reviews')
    .addTag('redmine')
    .addTag(
      'resolution-queue',
      'Unresolved blockers: classify, decide, resolve, verify',
    )
    .addTag(
      'regression-jobs',
      'Trigger a runner batch from the UI and watch its live log',
    )
    .addTag('search')
    .addTag('health')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Reporting API running on http://localhost:${port}`);
  console.log(`🚀 Reporting API running on http://localhost:${port}/api/docs`);
}
bootstrap();
