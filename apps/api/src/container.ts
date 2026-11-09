/**
 * Composition root: every service and controller of the API, and what each one is built from. Replaces
 * NestJS's modules and dependency injection (ADR 0041). Services are created once, on first use; the
 * order of PROVIDERS is the order their start hooks run (src/http/lifecycle.ts) and the reverse of the
 * order their stop hooks run. To add a service, add one line here; to add a controller, add it to
 * CONTROLLERS and its route function to ROUTES.
 */
import type { Router } from 'express';
import type { RouteKit } from './http/routes';
import { AiGateway } from './ai/ai-gateway';
import { AiProvider } from './ai/ai-provider';
import { AiSettingsController, aiSettingsControllerRoutes } from './ai/ai-settings.controller';
import { AiUsageRepository } from './ai/ai-usage.repository';
import { ArchitectService } from './ai/architect.service';
import { DynamicAiProvider } from './ai/dynamic-ai.provider';
import { ProposeService } from './ai/propose.service';
import { AnalysisController, analysisControllerRoutes } from './analysis/analysis.controller';
import { AnalysisService } from './analysis/analysis.service';
import { ResearchAssistantService } from './analysis/research.service';
import { AuthController, authControllerRoutes } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { PasswordResetService } from './auth/password-reset.service';
import { SamlService } from './auth/saml.service';
import { SsoController, ssoControllerRoutes } from './auth/sso.controller';
import { SsoService } from './auth/sso.service';
import {
  AutomationController,
  NotificationsController,
  automationControllerRoutes,
  notificationsControllerRoutes,
} from './automation/automation.controller';
import { AutomationQueue } from './automation/automation.queue';
import { AutomationService } from './automation/automation.service';
import {
  CapiAppController,
  CapiAssignmentsController,
  capiAppControllerRoutes,
  capiAssignmentsControllerRoutes,
} from './capi/capi.controller';
import { CapiService } from './capi/capi.service';
import { CaptureController, captureControllerRoutes } from './captures/capture.controller';
import { CaptureService } from './captures/capture.service';
import { TranscriptionService } from './captures/transcription.service';
import { CatiController, catiControllerRoutes } from './cati/cati.controller';
import { CatiService } from './cati/cati.service';
import { TelephonyController, telephonyControllerRoutes } from './cati/telephony.controller';
import { TelephonyService } from './cati/telephony.service';
import { ChangeSetsController, changeSetsControllerRoutes } from './changesets/changesets.controller';
import { ChangeSetsService } from './changesets/changesets.service';
import { AccessService } from './common/access.service';
import { AuditService } from './common/audit.service';
import { PrismaService } from './common/prisma.service';
import { DashboardController, dashboardControllerRoutes } from './dashboard/dashboard.controller';
import {
  DistributionController,
  UnsubscribeController,
  distributionControllerRoutes,
  unsubscribeControllerRoutes,
} from './distribution/distribution.controller';
import { DistributionService } from './distribution/distribution.service';
import { ApiKeysController, apiKeysControllerRoutes } from './enterprise/api-keys.controller';
import { AuditLogController, auditLogControllerRoutes } from './enterprise/audit-log.controller';
import { ExportRunner } from './exports/export-runner.service';
import { ExportService } from './exports/export.service';
import {
  CapiAppealsController,
  FieldworkController,
  capiAppealsControllerRoutes,
  fieldworkControllerRoutes,
} from './fieldwork/fieldwork.controller';
import { FieldworkService } from './fieldwork/fieldwork.service';
import { GovernanceController, governanceControllerRoutes } from './governance/governance.controller';
import { GovernanceService } from './governance/governance.service';
import { HealthController, healthControllerRoutes } from './health.controller';
import { JwtService } from './http/jwt';
import { CallbackWorker } from './integrations/callback.worker';
import { HttpDelivery } from './integrations/http-delivery';
import { IntegrationsController, integrationsControllerRoutes } from './integrations/integrations.controller';
import { RedirectRepository } from './integrations/redirect.repository';
import { LocalRedirectService, RedirectService } from './integrations/redirect.service';
import { VendorApiController, vendorApiControllerRoutes } from './integrations/vendor-api.controller';
import { WebhookService } from './integrations/webhook.service';
import { WebhooksController, webhooksControllerRoutes } from './integrations/webhooks.controller';
import { InterviewController, interviewControllerRoutes } from './interview/interview.controller';
import { InterviewService } from './interview/interview.service';
import { FileStore, SwitchingFileStore } from './jobs/file-store';
import { FilesService } from './jobs/files.service';
import { JobWorker } from './jobs/job.worker';
import { JobsController, jobsControllerRoutes } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { LibraryController, libraryControllerRoutes } from './library/library.controller';
import { MediaController, mediaControllerRoutes } from './media/media.controller';
import { MediaService } from './media/media.service';
import { MobileController, mobileControllerRoutes } from './mobile/mobile.controller';
import { BillingController, billingControllerRoutes } from './plans/billing.controller';
import { BillingService } from './plans/billing.service';
import { PlanService } from './plans/plan.service';
import { IntegrationSettingsService } from './platform/integration-settings.service';
import { PlatformIntegrationsController, platformIntegrationsControllerRoutes } from './platform/integrations.controller';
import { LocalSecretBox, SecretBox } from './platform/secret-box';
import { ProjectMembersController, projectMembersControllerRoutes } from './projects/members.controller';
import { ProjectsController, projectsControllerRoutes } from './projects/projects.controller';
import { QaController, qaControllerRoutes } from './qa/qa.controller';
import { QaService } from './qa/qa.service';
import { TestCasesController, testCasesControllerRoutes } from './qa/test-cases.controller';
import { NetworkReputationService } from './quality/network-reputation.service';
import {
  FraudBlocksController,
  QualityController,
  fraudBlocksControllerRoutes,
  qualityControllerRoutes,
} from './quality/quality.controller';
import { QualityService } from './quality/quality.service';
import { SampleonController, sampleonControllerRoutes } from './sampleon/sampleon.controller';
import { SampleonService } from './sampleon/sampleon.service';
import { ScimAdminController, scimAdminControllerRoutes } from './scim/scim-admin.controller';
import { ScimController, scimControllerRoutes } from './scim/scim.controller';
import { ScimGuard } from './scim/scim.guard';
import { EntitlementsService } from './super-admin/entitlements.service';
import { PlanCatalogService } from './super-admin/plan-catalog.service';
import { PlatformAutomationService } from './super-admin/platform-automation.service';
import {
  EntitlementsController,
  SuperAdminController,
  entitlementsControllerRoutes,
  superAdminControllerRoutes,
} from './super-admin/super-admin.controller';
import { SuperAdminService } from './super-admin/super-admin.service';
import { SurveysController, surveysControllerRoutes } from './surveys/surveys.controller';
import { SurveysService } from './surveys/surveys.service';
import { TranslateController, translateControllerRoutes } from './surveys/translate.controller';
import { TranslationToolsController, translationToolsControllerRoutes } from './surveys/translation-tools.controller';
import { PreferencesController, preferencesControllerRoutes } from './users/preferences.controller';
import { UsersController, usersControllerRoutes } from './users/users.controller';
import { VendorsController, vendorsControllerRoutes } from './vendors/vendors.controller';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Token<T = unknown> = abstract new (...args: any[]) => T;
export type Get = <T>(token: Token<T>) => T;
export type Factory = (get: Get) => unknown;

/** Services, in start order: shared ones first (database, audit, plans), then integrations, then the rest. */
export const PROVIDERS: Array<[Token, Factory]> = [
  [PrismaService, () => new PrismaService()],
  [AuditService, (get) => new AuditService(get(PrismaService))],
  [AccessService, () => new AccessService()],
  [PlanCatalogService, (get) => new PlanCatalogService(get(PrismaService))],
  [PlanService, (get) => new PlanService(get(PrismaService), get(PlanCatalogService))],
  [RedirectRepository, (get) => new RedirectRepository(get(PrismaService))],
  [HttpDelivery, () => new HttpDelivery()],
  [
    CallbackWorker,
    (get) => new CallbackWorker(get(RedirectRepository), get(RedirectService), get(HttpDelivery), get(SecretBox), get(WebhookService)),
  ],
  [WebhookService, (get) => new WebhookService(get(PrismaService), get(HttpDelivery), get(SecretBox), get(AutomationQueue))],
  [AutomationQueue, (get) => new AutomationQueue(get(PrismaService))],
  [SecretBox, () => new LocalSecretBox()],
  [RedirectService, (get) => new LocalRedirectService(get(RedirectRepository), get(SecretBox), get(WebhookService))],
  [SampleonService, (get) => new SampleonService(get(PrismaService), get(SurveysService), get(AuditService), get(SecretBox))],
  [IntegrationSettingsService, (get) => new IntegrationSettingsService(get(PrismaService), get(AuditService))],
  [CatiService, (get) => new CatiService(get(PrismaService), get(AuditService), get(AccessService), get(SecretBox), get(InterviewService))],
  [
    TelephonyService,
    (get) => new TelephonyService(get(PrismaService), get(AuditService), get(SecretBox), get(CatiService), get(CaptureService)),
  ],
  [AnalysisService, (get) => new AnalysisService(get(PrismaService), get(SurveysService), get(AuditService))],
  [ResearchAssistantService, (get) => new ResearchAssistantService(get(AnalysisService), get(AiGateway), get(AiProvider))],
  [MediaService, (get) => new MediaService(get(PrismaService), get(SurveysService), get(FileStore), get(AuditService))],
  [SsoService, (get) => new SsoService(get(PrismaService), get(SecretBox), get(PlanService), get(AuditService), get(SamlService))],
  [PasswordResetService, (get) => new PasswordResetService(get(PrismaService))],
  [SamlService, (get) => new SamlService(get(PrismaService))],
  [BillingService, (get) => new BillingService(get(PrismaService), get(AuditService))],
  [ScimGuard, (get) => new ScimGuard(get(PrismaService), get(PlanService))],
  [
    SurveysService,
    (get) => new SurveysService(get(PrismaService), get(AuditService), get(AccessService), get(WebhookService), get(PlanService)),
  ],
  [ExportService, () => new ExportService()],
  [
    InterviewService,
    (get) =>
      new InterviewService(
        get(PrismaService),
        get(AuditService),
        get(RedirectService),
        get(QualityService),
        get(PlanService),
        get(CaptureService),
        get(NetworkReputationService),
      ),
  ],
  [ChangeSetsService, (get) => new ChangeSetsService(get(PrismaService), get(AuditService), get(SurveysService))],
  [ArchitectService, (get) => new ArchitectService(get(AiProvider), get(AiGateway))],
  [AiGateway, (get) => new AiGateway(get(AiProvider), get(AiUsageRepository), get(AuditService))],
  [AiUsageRepository, (get) => new AiUsageRepository(get(PrismaService))],
  [
    QualityService,
    (get) =>
      new QualityService(
        get(PrismaService),
        get(AuditService),
        get(RedirectService),
        get(AccessService),
        get(WebhookService),
        get(CaptureService),
      ),
  ],
  [NetworkReputationService, (get) => new NetworkReputationService(get(PrismaService))],
  [TranscriptionService, (get) => new TranscriptionService(get(PrismaService), get(FileStore))],
  [CaptureService, (get) => new CaptureService(get(PrismaService), get(FileStore), get(AuditService), get(SurveysService))],
  [
    CapiService,
    (get) =>
      new CapiService(
        get(PrismaService),
        get(AuditService),
        get(QualityService),
        get(AccessService),
        get(WebhookService),
        get(CaptureService),
      ),
  ],
  [FieldworkService, (get) => new FieldworkService(get(PrismaService), get(AuditService), get(AccessService), get(QualityService))],
  [DistributionService, (get) => new DistributionService(get(PrismaService), get(AuditService), get(AccessService))],
  [QaService, (get) => new QaService(get(PrismaService), get(SurveysService), get(AuditService))],
  [ExportRunner, (get) => new ExportRunner(get(PrismaService), get(SurveysService), get(ExportService), get(AuditService))],
  [ProposeService, (get) => new ProposeService(get(ArchitectService), get(SurveysService), get(ChangeSetsService))],
  [JobsService, (get) => new JobsService(get(PrismaService), get(SurveysService), get(AuditService))],
  [
    JobWorker,
    (get) =>
      new JobWorker(
        get(PrismaService),
        get(FilesService),
        get(ExportRunner),
        get(QaService),
        get(ProposeService),
        get(CaptureService),
        get(TranscriptionService),
        get(TelephonyService),
        get(DistributionService),
        get(AutomationService),
        get(GovernanceService),
      ),
  ],
  [FilesService, (get) => new FilesService(get(PrismaService), get(FileStore))],
  [
    AutomationService,
    (get) => new AutomationService(get(PrismaService), get(AuditService), get(AccessService), get(PlanService), get(WebhookService)),
  ],
  [GovernanceService, (get) => new GovernanceService(get(PrismaService), get(AuditService), get(CaptureService))],
  [
    SuperAdminService,
    (get) =>
      new SuperAdminService(
        get(PrismaService),
        get(AuditService),
        get(PlanService),
        get(PlanCatalogService),
        get(PasswordResetService),
        get(IntegrationSettingsService),
        get(EntitlementsService),
      ),
  ],
  [EntitlementsService, (get) => new EntitlementsService(get(PrismaService), get(PlanCatalogService))],
  [
    PlatformAutomationService,
    (get) =>
      new PlatformAutomationService(
        get(PrismaService),
        get(AuditService),
        get(PlanService),
        get(PlanCatalogService),
        get(EntitlementsService),
      ),
  ],
  [AiProvider, () => new DynamicAiProvider()],
  [DynamicAiProvider, () => new DynamicAiProvider()],
  [FileStore, () => new SwitchingFileStore()],
  [SwitchingFileStore, () => new SwitchingFileStore()],
  [AuthGuard, (get) => new AuthGuard(get(JwtService), get(PrismaService), get(PlanCatalogService))],
  [JwtService, () => new JwtService()],
];

export const CONTROLLERS: Array<[Token, Factory]> = [
  [HealthController, (get) => new HealthController(get(PrismaService))],
  [MobileController, () => new MobileController()],
  [DashboardController, (get) => new DashboardController(get(PrismaService), get(AccessService))],
  [PlatformIntegrationsController, (get) => new PlatformIntegrationsController(get(IntegrationSettingsService))],
  [TelephonyController, (get) => new TelephonyController(get(TelephonyService))],
  [
    AuthController,
    (get) =>
      new AuthController(
        get(PrismaService),
        get(JwtService),
        get(AuditService),
        get(SsoService),
        get(PasswordResetService),
        get(IntegrationSettingsService),
        get(EntitlementsService),
      ),
  ],
  [UsersController, (get) => new UsersController(get(PrismaService), get(AuditService), get(PlanService), get(PasswordResetService))],
  [PreferencesController, (get) => new PreferencesController(get(PrismaService), get(AuditService))],
  [CatiController, (get) => new CatiController(get(CatiService))],
  [AnalysisController, (get) => new AnalysisController(get(AnalysisService), get(ResearchAssistantService))],
  [MediaController, (get) => new MediaController(get(MediaService))],
  [SsoController, (get) => new SsoController(get(SsoService), get(JwtService), get(SamlService))],
  [ScimController, (get) => new ScimController(get(PrismaService), get(AuditService), get(PlanService))],
  [ScimAdminController, (get) => new ScimAdminController(get(PrismaService), get(AuditService), get(PlanService))],
  [BillingController, (get) => new BillingController(get(BillingService))],
  [ProjectsController, (get) => new ProjectsController(get(PrismaService), get(AuditService), get(AccessService))],
  [
    SurveysController,
    (get) => new SurveysController(get(SurveysService), get(PrismaService), get(ExportRunner), get(AuditService), get(AccessService)),
  ],
  [
    VendorsController,
    (get) => new VendorsController(get(PrismaService), get(AuditService), get(RedirectService), get(SecretBox), get(AccessService)),
  ],
  [LibraryController, (get) => new LibraryController(get(PrismaService), get(AuditService))],
  [InterviewController, (get) => new InterviewController(get(InterviewService))],
  [QaController, (get) => new QaController(get(PrismaService), get(SurveysService), get(QaService))],
  [TestCasesController, (get) => new TestCasesController(get(PrismaService), get(AuditService), get(SurveysService))],
  [
    ChangeSetsController,
    (get) => new ChangeSetsController(get(ChangeSetsService), get(SurveysService), get(ProposeService), get(AiGateway)),
  ],
  [
    TranslateController,
    (get) => new TranslateController(get(AiProvider), get(AiGateway), get(SurveysService), get(PrismaService), get(AuditService)),
  ],
  [TranslationToolsController, (get) => new TranslationToolsController(get(PrismaService), get(AuditService), get(SurveysService))],
  [AiSettingsController, (get) => new AiSettingsController(get(AiGateway), get(AiUsageRepository), get(AuditService))],
  [QualityController, (get) => new QualityController(get(QualityService))],
  [FraudBlocksController, (get) => new FraudBlocksController(get(QualityService))],
  [
    CaptureController,
    (get) => new CaptureController(get(CaptureService), get(InterviewService), get(JobsService), get(TranscriptionService)),
  ],
  [CapiAssignmentsController, (get) => new CapiAssignmentsController(get(CapiService))],
  [CapiAppController, (get) => new CapiAppController(get(CapiService))],
  [FieldworkController, (get) => new FieldworkController(get(FieldworkService))],
  [DistributionController, (get) => new DistributionController(get(DistributionService))],
  [UnsubscribeController, (get) => new UnsubscribeController(get(DistributionService))],
  [CapiAppealsController, (get) => new CapiAppealsController(get(FieldworkService))],
  [ProjectMembersController, (get) => new ProjectMembersController(get(PrismaService), get(AuditService), get(AccessService))],
  [ApiKeysController, (get) => new ApiKeysController(get(PrismaService), get(AuditService))],
  [AuditLogController, (get) => new AuditLogController(get(PrismaService), get(AuditService))],
  [
    JobsController,
    (get) =>
      new JobsController(get(JobsService), get(FilesService), get(SurveysService), get(ProposeService), get(JobWorker), get(AuditService)),
  ],
  [AutomationController, (get) => new AutomationController(get(AutomationService))],
  [NotificationsController, (get) => new NotificationsController(get(AutomationService))],
  [GovernanceController, (get) => new GovernanceController(get(GovernanceService))],
  [EntitlementsController, (get) => new EntitlementsController(get(EntitlementsService))],
  [SuperAdminController, (get) => new SuperAdminController(get(SuperAdminService), get(PlatformAutomationService))],
  [SampleonController, (get) => new SampleonController(get(SampleonService))],
  [
    IntegrationsController,
    (get) =>
      new IntegrationsController(get(PrismaService), get(AuditService), get(RedirectRepository), get(CallbackWorker), get(AccessService)),
  ],
  [VendorApiController, (get) => new VendorApiController(get(RedirectRepository), get(AuditService))],
  [WebhooksController, (get) => new WebhooksController(get(PrismaService), get(AuditService), get(SecretBox), get(WebhookService))],
];

/** Route functions, in the order routes are matched (the first match answers). */
export const ROUTES: Array<(r: Router, get: Get, kit: RouteKit) => void> = [
  (r, get, kit) => healthControllerRoutes(r, get(HealthController), kit),
  (r, get, kit) => mobileControllerRoutes(r, get(MobileController), kit),
  (r, get, kit) => dashboardControllerRoutes(r, get(DashboardController), kit),
  (r, get, kit) => platformIntegrationsControllerRoutes(r, get(PlatformIntegrationsController), kit),
  (r, get, kit) => telephonyControllerRoutes(r, get(TelephonyController), kit),
  (r, get, kit) => authControllerRoutes(r, get(AuthController), kit),
  (r, get, kit) => usersControllerRoutes(r, get(UsersController), kit),
  (r, get, kit) => preferencesControllerRoutes(r, get(PreferencesController), kit),
  (r, get, kit) => catiControllerRoutes(r, get(CatiController), kit),
  (r, get, kit) => analysisControllerRoutes(r, get(AnalysisController), kit),
  (r, get, kit) => mediaControllerRoutes(r, get(MediaController), kit),
  (r, get, kit) => ssoControllerRoutes(r, get(SsoController), kit),
  (r, get, kit) => scimControllerRoutes(r, get(ScimController), kit),
  (r, get, kit) => scimAdminControllerRoutes(r, get(ScimAdminController), kit),
  (r, get, kit) => billingControllerRoutes(r, get(BillingController), kit),
  (r, get, kit) => projectsControllerRoutes(r, get(ProjectsController), kit),
  (r, get, kit) => surveysControllerRoutes(r, get(SurveysController), kit),
  (r, get, kit) => vendorsControllerRoutes(r, get(VendorsController), kit),
  (r, get, kit) => libraryControllerRoutes(r, get(LibraryController), kit),
  (r, get, kit) => interviewControllerRoutes(r, get(InterviewController), kit),
  (r, get, kit) => qaControllerRoutes(r, get(QaController), kit),
  (r, get, kit) => testCasesControllerRoutes(r, get(TestCasesController), kit),
  (r, get, kit) => changeSetsControllerRoutes(r, get(ChangeSetsController), kit),
  (r, get, kit) => translateControllerRoutes(r, get(TranslateController), kit),
  (r, get, kit) => translationToolsControllerRoutes(r, get(TranslationToolsController), kit),
  (r, get, kit) => aiSettingsControllerRoutes(r, get(AiSettingsController), kit),
  (r, get, kit) => qualityControllerRoutes(r, get(QualityController), kit),
  (r, get, kit) => fraudBlocksControllerRoutes(r, get(FraudBlocksController), kit),
  (r, get, kit) => captureControllerRoutes(r, get(CaptureController), kit),
  (r, get, kit) => capiAssignmentsControllerRoutes(r, get(CapiAssignmentsController), kit),
  (r, get, kit) => capiAppControllerRoutes(r, get(CapiAppController), kit),
  (r, get, kit) => fieldworkControllerRoutes(r, get(FieldworkController), kit),
  (r, get, kit) => distributionControllerRoutes(r, get(DistributionController), kit),
  (r, get, kit) => unsubscribeControllerRoutes(r, get(UnsubscribeController), kit),
  (r, get, kit) => capiAppealsControllerRoutes(r, get(CapiAppealsController), kit),
  (r, get, kit) => projectMembersControllerRoutes(r, get(ProjectMembersController), kit),
  (r, get, kit) => apiKeysControllerRoutes(r, get(ApiKeysController), kit),
  (r, get, kit) => auditLogControllerRoutes(r, get(AuditLogController), kit),
  (r, get, kit) => jobsControllerRoutes(r, get(JobsController), kit),
  (r, get, kit) => automationControllerRoutes(r, get(AutomationController), kit),
  (r, get, kit) => notificationsControllerRoutes(r, get(NotificationsController), kit),
  (r, get, kit) => governanceControllerRoutes(r, get(GovernanceController), kit),
  (r, get, kit) => entitlementsControllerRoutes(r, get(EntitlementsController), kit),
  (r, get, kit) => superAdminControllerRoutes(r, get(SuperAdminController), kit),
  (r, get, kit) => sampleonControllerRoutes(r, get(SampleonController), kit),
  (r, get, kit) => integrationsControllerRoutes(r, get(IntegrationsController), kit),
  (r, get, kit) => vendorApiControllerRoutes(r, get(VendorApiController), kit),
  (r, get, kit) => webhooksControllerRoutes(r, get(WebhooksController), kit),
];

/** Builds each service once, on first use. `overrides` replaces a service with a given value (tests). */
export class Container {
  private readonly factories = new Map<Token, Factory>([...PROVIDERS, ...CONTROLLERS]);
  private readonly instances = new Map<Token, unknown>();
  private readonly building = new Set<Token>();

  constructor(overrides: Array<[Token, unknown]> = []) {
    for (const [token, value] of overrides) this.instances.set(token, value);
  }

  readonly get: Get = <T>(token: Token<T>): T => {
    if (this.instances.has(token)) return this.instances.get(token) as T;
    const factory = this.factories.get(token);
    if (!factory) throw new Error(`${token.name} is not registered in src/container.ts`);
    if (this.building.has(token)) throw new Error(`Circular dependency while building ${token.name}`);
    this.building.add(token);
    try {
      const value = factory(this.get);
      this.instances.set(token, value);
      return value as T;
    } finally {
      this.building.delete(token);
    }
  };

  /** Every service, in PROVIDERS order (built if needed), then every controller. */
  all(): unknown[] {
    return [...PROVIDERS, ...CONTROLLERS].map(([token]) => this.get(token));
  }
}
