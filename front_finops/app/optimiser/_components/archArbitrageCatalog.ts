// Rule catalog for architecture arbitrage detection.
//
// A rule fires when a member's billing "byService" line matches its keywords.
// The savings ranges are indicative ballparks drawn from the AWS/GCP/Azure
// Well-Architected cost-optimisation guides and public case studies — treat
// them as workshop conversation starters, not commitments. Real gain depends
// on the workload's utilisation profile and migration cost.
//
// Keep entries lowercase — the matcher normalises the incoming service name.
// Order matters when two rules could match: the first match wins.

export type Category = "compute" | "database" | "storage" | "network"
export type CloudProvider = "aws" | "gcp" | "azure" | "any"

export interface Alternative {
  name: string
  fitFor: string
  savingsPct: [number, number]
  tradeOffs: string
}

export interface ArbitrageRule {
  id: string
  category: Category
  provider: CloudProvider
  // Substrings (lowercase) matched against the billing service name. First
  // rule with any keyword found in the name wins.
  keywords: string[]
  title: string
  currentContext: string
  alternatives: Alternative[]
}

export const ARBITRAGE_RULES: ArbitrageRule[] = [
  // ------------------------- AWS Compute -----------------------------------
  {
    id: "aws-ec2",
    category: "compute",
    provider: "aws",
    keywords: ["ec2", "elastic compute cloud"],
    title: "EC2 : instances 24/7",
    currentContext:
      "Machines virtuelles managées, coût plein tarif hors Savings Plans.",
    alternatives: [
      {
        name: "ECS Fargate",
        fitFor: "Workload containerisé stateless avec autoscale.",
        savingsPct: [10, 25],
        tradeOffs:
          "Migration container obligatoire, plus d'accès SSH direct sur l'instance.",
      },
      {
        name: "App Runner",
        fitFor: "API HTTP à trafic variable, déploiement image ECR simple.",
        savingsPct: [30, 50],
        tradeOffs:
          "Port unique, options VPC limitées, moins adapté aux backends complexes.",
      },
      {
        name: "Lambda",
        fitFor: "Requêtes événementielles < 15 min, concurrence modérée.",
        savingsPct: [60, 80],
        tradeOffs:
          "Cold-start, payload plafonné à 6 Mo (sync), pas adapté aux batchs longs.",
      },
      {
        name: "Savings Plans / RI",
        fitFor: "Charge stable, engagement 1 ou 3 ans envisageable.",
        savingsPct: [20, 45],
        tradeOffs:
          "Engagement financier, exposition au risque d'over-commit si le workload évolue.",
      },
    ],
  },
  {
    id: "aws-ecs",
    category: "compute",
    provider: "aws",
    keywords: ["ecs", "elastic container service"],
    title: "ECS on EC2",
    currentContext:
      "Cluster containers auto-gérés sur EC2 : rightsizing et bin-packing manuels.",
    alternatives: [
      {
        name: "ECS Fargate",
        fitFor: "Réduire l'ops sans changer d'orchestrateur.",
        savingsPct: [0, 15],
        tradeOffs:
          "Peut coûter plus cher au CPU/h mais élimine l'over-provisioning des EC2.",
      },
      {
        name: "App Runner",
        fitFor: "Services HTTP simples déployés depuis ECR.",
        savingsPct: [20, 40],
        tradeOffs:
          "Perte du contrôle fin ECS (sidecars, service discovery avancé).",
      },
    ],
  },
  {
    id: "aws-eks",
    category: "compute",
    provider: "aws",
    keywords: ["eks", "elastic kubernetes"],
    title: "EKS : cluster Kubernetes managé",
    currentContext:
      "Control-plane facturé + nœuds EC2 : coût fixe important même à faible charge.",
    alternatives: [
      {
        name: "EKS Auto Mode",
        fitFor: "Garder K8s mais laisser AWS gérer le node pool.",
        savingsPct: [10, 25],
        tradeOffs: "Moins de personnalisation des nœuds.",
      },
      {
        name: "ECS Fargate",
        fitFor: "Sortir de K8s si un seul service ou petit portefeuille.",
        savingsPct: [20, 40],
        tradeOffs:
          "Perte de l'écosystème K8s (Helm, opérateurs, GitOps kubectl-first).",
      },
      {
        name: "App Runner",
        fitFor: "Cluster hébergeant essentiellement des APIs HTTP simples.",
        savingsPct: [40, 60],
        tradeOffs: "Sortie K8s totale + limites réseau du service.",
      },
    ],
  },
  {
    id: "aws-lambda",
    category: "compute",
    provider: "aws",
    keywords: ["lambda"],
    title: "Lambda : fonctions serverless",
    currentContext:
      "Facturation à l'invocation. Peut devenir cher au-delà de ~1 M invocations/j.",
    alternatives: [
      {
        name: "Provisioned Concurrency + Compute Savings Plans",
        fitFor: "Trafic prévisible, réduire cold-starts et lisser le coût.",
        savingsPct: [10, 25],
        tradeOffs: "Engagement financier, non idéal si trafic très erratique.",
      },
      {
        name: "ECS Fargate",
        fitFor: "Basculement pour workload continu > 15 min ou payload lourde.",
        savingsPct: [15, 35],
        tradeOffs: "Réintroduit la gestion de conteneurs et de l'autoscale.",
      },
    ],
  },
  // ------------------------- AWS Databases ---------------------------------
  {
    id: "aws-rds",
    category: "database",
    provider: "aws",
    keywords: ["rds", "relational database"],
    title: "RDS : bases relationnelles provisionnées",
    currentContext:
      "Instances 24/7 dimensionnées sur le pic. Utilisation moyenne souvent < 30 %.",
    alternatives: [
      {
        name: "Aurora Serverless v2",
        fitFor: "Charge variable, dev/test, saisonnalité forte.",
        savingsPct: [20, 40],
        tradeOffs:
          "Latence légèrement supérieure au cold-start ACU, gestion des connexions à revoir.",
      },
      {
        name: "RDS Reserved Instances",
        fitFor: "Charge stable, engagement 1 ou 3 ans acceptable.",
        savingsPct: [30, 55],
        tradeOffs: "Engagement financier, non transférable sans coût.",
      },
      {
        name: "DynamoDB on-demand",
        fitFor: "Modèle clé-valeur ou hiérarchique, requêtes simples.",
        savingsPct: [30, 60],
        tradeOffs:
          "Migration schéma majeure : perte des joins, ré-architecture applicative.",
      },
    ],
  },
  {
    id: "aws-dynamodb",
    category: "database",
    provider: "aws",
    keywords: ["dynamodb"],
    title: "DynamoDB : capacité provisionnée",
    currentContext:
      "Capacité RCU/WCU réservée en continu, souvent sur-dimensionnée face au trafic réel.",
    alternatives: [
      {
        name: "On-demand billing",
        fitFor: "Trafic imprévisible ou spike-y, faible volume moyen.",
        savingsPct: [30, 50],
        tradeOffs:
          "Coût unitaire supérieur ; se retourne contre vous à forte utilisation stable.",
      },
      {
        name: "Auto-scaling + reserved capacity",
        fitFor: "Trafic stable avec base minimale identifiable.",
        savingsPct: [20, 40],
        tradeOffs:
          "Engagement financier sur la baseline ; réglage plus fin à opérer.",
      },
    ],
  },
  {
    id: "aws-elasticache",
    category: "database",
    provider: "aws",
    keywords: ["elasticache"],
    title: "ElastiCache : cache managé",
    currentContext: "Nodes Redis/Memcached facturés en continu.",
    alternatives: [
      {
        name: "Reserved Nodes",
        fitFor: "Charge cache stable, indisponible en tier low.",
        savingsPct: [30, 55],
        tradeOffs: "Engagement 1/3 ans, non modifiable après achat.",
      },
      {
        name: "MemoryDB for Redis",
        fitFor: "Besoin de durabilité + throughput cache, remplace Redis + RDS.",
        savingsPct: [0, 20],
        tradeOffs:
          "Prix par node supérieur, gain vient d'éliminer une base secondaire.",
      },
    ],
  },
  // ------------------------- AWS Storage / Network -------------------------
  {
    id: "aws-s3",
    category: "storage",
    provider: "aws",
    keywords: ["s3", "simple storage"],
    title: "S3 Standard : stockage objet chaud",
    currentContext:
      "Toutes les données au tarif chaud, même celles rarement accédées.",
    alternatives: [
      {
        name: "S3 Intelligent-Tiering",
        fitFor: "Patterns d'accès inconnus ou variables.",
        savingsPct: [10, 30],
        tradeOffs:
          "Petit surcoût de monitoring, gain nul sous 128 Ko / objet.",
      },
      {
        name: "S3 Glacier Instant / Flexible / Deep Archive",
        fitFor: "Archives réglementaires, backups > 90 jours.",
        savingsPct: [40, 80],
        tradeOffs:
          "Frais de restauration, latence de retrieval selon la classe choisie.",
      },
    ],
  },
  {
    id: "aws-ebs",
    category: "storage",
    provider: "aws",
    keywords: ["ebs", "elastic block store"],
    title: "EBS : volumes gp2",
    currentContext:
      "Volumes gp2 legacy : perfs couplées à la taille, souvent surdimensionnés.",
    alternatives: [
      {
        name: "gp3",
        fitFor: "La plupart des workloads bloc — nouveau défaut AWS.",
        savingsPct: [15, 20],
        tradeOffs:
          "Aucun impact fonctionnel majeur ; migration à chaud possible.",
      },
    ],
  },
  {
    id: "aws-nat",
    category: "network",
    provider: "aws",
    keywords: ["nat gateway"],
    title: "NAT Gateway : trafic sortant VPC",
    currentContext:
      "Facturé au Go traité + horaire. Domine parfois la facture réseau des workloads S3/DynamoDB en VPC privé.",
    alternatives: [
      {
        name: "VPC Endpoints (Gateway + Interface)",
        fitFor: "Accès à S3, DynamoDB, KMS, ECR, Bedrock… depuis VPC privé.",
        savingsPct: [25, 60],
        tradeOffs:
          "Configuration IAM/route tables supplémentaire, cap sur les services couverts.",
      },
    ],
  },
  // ------------------------- GCP -------------------------------------------
  {
    id: "gcp-compute",
    category: "compute",
    provider: "gcp",
    keywords: ["compute engine", "gce"],
    title: "Compute Engine : VMs 24/7",
    currentContext:
      "Machines virtuelles GCE facturées à l'heure, sans CUD.",
    alternatives: [
      {
        name: "Cloud Run",
        fitFor: "Services HTTP stateless containerisés.",
        savingsPct: [30, 60],
        tradeOffs:
          "Concurrence par instance limitée, cold-start, migration container.",
      },
      {
        name: "GKE Autopilot",
        fitFor: "Écosystème K8s conservé mais nœuds facturés au pod.",
        savingsPct: [10, 25],
        tradeOffs: "Personnalisation des nœuds réduite.",
      },
      {
        name: "Committed Use Discounts (CUD)",
        fitFor: "Charge stable, engagement 1 ou 3 ans.",
        savingsPct: [20, 55],
        tradeOffs: "Engagement financier, moins flexible.",
      },
    ],
  },
  {
    id: "gcp-gke",
    category: "compute",
    provider: "gcp",
    keywords: ["kubernetes", "gke"],
    title: "GKE Standard : cluster K8s",
    currentContext:
      "Nœuds provisionnés en continu + management fee du control-plane.",
    alternatives: [
      {
        name: "GKE Autopilot",
        fitFor: "Réduire l'ops et facturer au pod plutôt qu'au nœud.",
        savingsPct: [15, 35],
        tradeOffs:
          "Personnalisation nœud réduite, contraintes sur DaemonSets et privilèges.",
      },
      {
        name: "Cloud Run",
        fitFor: "Si le cluster héberge quelques services HTTP indépendants.",
        savingsPct: [40, 60],
        tradeOffs: "Sortie K8s complète.",
      },
    ],
  },
  {
    id: "gcp-cloudsql",
    category: "database",
    provider: "gcp",
    keywords: ["cloud sql"],
    title: "Cloud SQL : instances relationnelles",
    currentContext:
      "Instances 24/7 dimensionnées sur pic. Souvent < 30 % d'utilisation en moyenne.",
    alternatives: [
      {
        name: "AlloyDB Serverless",
        fitFor: "Postgres à charge variable, besoins analytiques.",
        savingsPct: [20, 40],
        tradeOffs: "Migration Postgres compatible, mais version spécifique.",
      },
      {
        name: "Cloud SQL CUD",
        fitFor: "Charge stable, engagement 1 ou 3 ans.",
        savingsPct: [25, 52],
        tradeOffs: "Engagement financier.",
      },
      {
        name: "Firestore / Spanner",
        fitFor: "Modèle NoSQL / globalement distribué.",
        savingsPct: [15, 45],
        tradeOffs:
          "Refactoring applicatif majeur, perte des joins/SQL avancés.",
      },
    ],
  },
  {
    id: "gcp-gcs",
    category: "storage",
    provider: "gcp",
    keywords: ["cloud storage", "gcs"],
    title: "Cloud Storage : classe Standard",
    currentContext:
      "Tous les objets au tarif hot, même les archives peu accédées.",
    alternatives: [
      {
        name: "Nearline / Coldline / Archive",
        fitFor: "Données accédées mensuellement ou moins.",
        savingsPct: [30, 75],
        tradeOffs: "Frais de retrieval, latence supérieure.",
      },
      {
        name: "Autoclass",
        fitFor: "Patterns d'accès inconnus, laisse GCP arbitrer.",
        savingsPct: [10, 40],
        tradeOffs: "Petit frais de gestion par objet.",
      },
    ],
  },
  // ------------------------- Azure -----------------------------------------
  {
    id: "azure-vm",
    category: "compute",
    provider: "azure",
    keywords: ["virtual machines", "vm "],
    title: "Azure Virtual Machines",
    currentContext:
      "VMs facturées 24/7, souvent sans Reserved Instances ni Savings Plans.",
    alternatives: [
      {
        name: "Container Apps",
        fitFor: "Services containerisés, scale-to-zero possible.",
        savingsPct: [30, 55],
        tradeOffs: "Migration container, options réseau restreintes.",
      },
      {
        name: "App Service",
        fitFor: "Applications web classiques (.NET, Node, Python).",
        savingsPct: [20, 40],
        tradeOffs: "Moins de contrôle bas-niveau.",
      },
      {
        name: "Reserved Instances / Savings Plans",
        fitFor: "Charge stable, engagement 1 ou 3 ans.",
        savingsPct: [25, 55],
        tradeOffs: "Engagement financier.",
      },
    ],
  },
  {
    id: "azure-aks",
    category: "compute",
    provider: "azure",
    keywords: ["kubernetes service", "aks"],
    title: "AKS : cluster Kubernetes managé",
    currentContext: "Nœuds VMSS provisionnés en continu, control-plane gratuit ou premium.",
    alternatives: [
      {
        name: "AKS Automatic",
        fitFor: "Garder K8s avec management poussé par Azure.",
        savingsPct: [10, 25],
        tradeOffs: "Moins de contrôle nœud.",
      },
      {
        name: "Container Apps",
        fitFor: "Sortir de K8s pour des services simples.",
        savingsPct: [30, 55],
        tradeOffs: "Sortie K8s totale, réécriture manifestes.",
      },
    ],
  },
  {
    id: "azure-sql",
    category: "database",
    provider: "azure",
    keywords: ["sql database", "azure sql"],
    title: "Azure SQL Database",
    currentContext:
      "DTU ou vCore provisionné 24/7. Coût dominant même à faible utilisation.",
    alternatives: [
      {
        name: "SQL Database Serverless",
        fitFor: "Charge variable, dev/test, apps intermittentes.",
        savingsPct: [20, 45],
        tradeOffs: "Pause + reprise ajoute quelques secondes de latence.",
      },
      {
        name: "Elastic Pools",
        fitFor: "Portefeuille de nombreuses bases faiblement chargées.",
        savingsPct: [30, 55],
        tradeOffs:
          "Requiert la mutualisation, une base gourmande peut affecter les autres.",
      },
    ],
  },
]

// Normalise a raw service name (case, punctuation, extra whitespace) so the
// keyword matcher stays predictable across providers' name conventions.
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
}

export interface MatchedArbitrage {
  rule: ArbitrageRule
  // Comma-joined billing line names that fired this rule (e.g. "EC2 - Compute,
  // EC2 - Other Instance Hours"). Truncated for display, full string kept for
  // tooltips or downstream analytics.
  service: string
  matchCount: number
  monthlyCost: number
  potentialSavingsRange: [number, number]
}

// Match a portfolio member's services against the rule catalog. Returns one
// MatchedArbitrage per rule that fires — a member with EC2 + RDS + S3 yields
// three entries. Multiple billing lines matching the same rule (AWS often
// splits EC2 across several skus) are collapsed so React keys stay unique and
// the UI doesn't show three "EC2" cards with the same recommendation.
export function matchServices(
  services: { service: string; cost: number }[],
  months: number,
): MatchedArbitrage[] {
  const divisor = Math.max(months, 1)
  const byRule = new Map<string, MatchedArbitrage>()
  for (const s of services) {
    if (s.cost <= 0) continue
    const normalized = normalise(s.service)
    // First rule with any keyword substring found wins — keywords are already
    // lowercase and use the same normalisation.
    for (const rule of ARBITRAGE_RULES) {
      const hit = rule.keywords.some((kw) => normalized.includes(normalise(kw)))
      if (!hit) continue
      const monthly = s.cost / divisor
      const existing = byRule.get(rule.id)
      if (existing) {
        existing.monthlyCost += monthly
        existing.matchCount += 1
        // Append the service name if it wasn't already listed. Cheap because
        // matchCount stays small in practice (a handful of skus per rule).
        if (!existing.service.split(", ").includes(s.service)) {
          existing.service = `${existing.service}, ${s.service}`
        }
      } else {
        byRule.set(rule.id, {
          rule,
          service: s.service,
          matchCount: 1,
          monthlyCost: monthly,
          potentialSavingsRange: [0, 0], // recomputed once aggregation is done
        })
      }
      break
    }
  }

  // Recompute savings against the aggregated monthly cost so the fourchette
  // reflects the full spend attributed to the rule, not just the first sku.
  const out: MatchedArbitrage[] = []
  for (const m of byRule.values()) {
    const minPct = Math.min(...m.rule.alternatives.map((a) => a.savingsPct[0]))
    const maxPct = Math.max(...m.rule.alternatives.map((a) => a.savingsPct[1]))
    out.push({
      ...m,
      potentialSavingsRange: [
        m.monthlyCost * (minPct / 100),
        m.monthlyCost * (maxPct / 100),
      ],
    })
  }
  out.sort((a, b) => b.monthlyCost - a.monthlyCost)
  return out
}
