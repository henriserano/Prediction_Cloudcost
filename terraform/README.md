# Terraform · Infrastructure AWS

Infrastructure as code pour le backend FinOps. Déploie une architecture AWS ECS Fargate + ALB + ECR + VPC dans la région `eu-west-1`, avec CloudWatch logs/alarms et auto-scaling.

---

## Sommaire

1. [Architecture](#architecture)
2. [Fichiers Terraform](#fichiers-terraform)
3. [Variables & outputs](#variables--outputs)
4. [Prérequis & première utilisation](#prérequis--première-utilisation)
5. [Cycle de déploiement (`deploy.sh`)](#cycle-de-déploiement-deploysh)
6. [Sécurité — IAM, SG, secrets](#sécurité--iam-sg-secrets)
7. [Monitoring & auto-scaling](#monitoring--auto-scaling)
8. [Gaps connus & TODO avant prod](#gaps-connus--todo-avant-prod)

---

## Architecture

```
                             Internet (0.0.0.0/0)
                                     │
                                     ▼
┌────────────────────────────── AWS Region eu-west-1 ─────────────────────────────┐
│                                                                                  │
│  ┌───────────────────────── VPC 10.0.0.0/16 ──────────────────────────────┐   │
│  │                                                                          │   │
│  │  IGW  finops-<env>-igw                                                   │   │
│  │                                                                          │   │
│  │  ┌── Public subnet 0 (10.0.0.0/24, eu-west-1a) ──────────────────────┐  │   │
│  │  │  ┌─────────────────────────────┐   ┌──────────────────────────┐   │  │   │
│  │  │  │ ALB  finops-<env>-alb        │   │ ECS Task (Fargate SPOT) │   │  │   │
│  │  │  │ SG : 80, 443 from 0.0.0.0/0 │──►│ backend :8080           │   │  │   │
│  │  │  └─────────────────────────────┘   │ CPU 512 · Mem 2048       │   │  │   │
│  │  │                                    │ SG : 8080 only from ALB  │   │  │   │
│  │  │                                    └──────────────────────────┘   │  │   │
│  │  └────────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                          │   │
│  │  ┌── Public subnet 1 (10.0.1.0/24, eu-west-1b) ──────────────────────┐  │   │
│  │  │  Réplique ALB · Tâches auto-scaling (prod uniquement, max 2)      │  │   │
│  │  └────────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                          │   │
│  │  Route table publique → 0.0.0.0/0 via IGW                                │   │
│  │  (pas de subnet privé · pas de NAT gateway)                              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ECR : finops-<env>-backend (lifecycle : garde 5 images)                         │
│  CloudWatch Logs : /ecs/finops-<env>  (retention 30j prod / 7j dev)              │
│  CloudWatch Alarms : cpu-high, memory-high, alb-5xx, unhealthy-hosts             │
│  Auto-scaling : CPU 60% target · Memory 70% target  (min=1, max=2 prod)          │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Choix architecturaux clés**

| Décision | Motif |
|---|---|
| Fargate + FARGATE_SPOT (weight 4) | Économie ~70% vs FARGATE — acceptable pour dev/staging, à réévaluer prod |
| Subnets **publics** avec IPs publiques sur les tâches | Pas de NAT gateway → économie ~35 €/mois par AZ. Trade-off sécurité couvert par les Security Groups |
| Circuit breaker ECS activé | Rollback auto si health checks échouent |
| `ignore_changes = [task_definition, desired_count]` sur le service | `deploy.sh` gère les updates via AWS CLI ; auto-scaling gère `desired_count` |
| `containerInsights = disabled` | Économie ~10 €/mois — logs applicatifs et alarms suffisent |
| HTTP-only par défaut (`certificate_arn = ""`) | Certificat ACM à provisionner séparément avant activation HTTPS |

---

## Fichiers Terraform

| Fichier | Contenu |
|---|---|
| `main.tf` | Bloc `terraform { required_version ≥ 1.6 }` + provider AWS ~> 5.50. Bloc backend S3 **commenté** — state actuellement en local |
| `variables.tf` | Toutes les variables (voir tableau ci-dessous) avec validators |
| `locals.tf` | `prefix = "${app_name}-${env}"`, `azs` dynamiques via data source, `public_subnets` calculés (`cidrsubnet`), `ecr_image`, `https_enabled` |
| `vpc.tf` | VPC · IGW · N × subnets publics · route table + associations |
| `security_groups.tf` | `sg-alb` (80/443 depuis Internet) · `sg-ecs` (8080 depuis `sg-alb` uniquement) |
| `ecr.tf` | Repository ECR avec scan on push + lifecycle policy (garde les 5 dernières images) |
| `iam.tf` | Execution role ECS · Task role ECS (least privilege — logs only) · Policy CI/CD push ECR |
| `alb.tf` | ALB · Target group `ip` (Fargate) · Listener HTTP (redirect vers HTTPS si activé) · Listener HTTPS conditionnel |
| `ecs.tf` | Cluster · Capacity providers (FARGATE_SPOT default) · Task definition · Service (rolling deploy, circuit breaker) |
| `cloudwatch.tf` | Log group + 4 alarmes (cpu-high, memory-high, alb-5xx, unhealthy-hosts) |
| `autoscaling.tf` | Target tracking : CPU 60% + Memory 70%. Max = 2 (prod), 1 (dev/staging) |
| `outputs.tf` | 8 outputs consommés par `deploy.sh` (voir tableau ci-dessous) |
| `vpc_endpoints.tf` | ⚠️ **Fichier vide** — voir [Gaps connus](#gaps-connus--todo-avant-prod) |
| `terraform.tfvars.example` | Template à copier vers `terraform.tfvars` (jamais committé) |

---

## Variables & outputs

### Variables (`variables.tf`)

| Variable | Type | Défaut | Validation | Description |
|---|---|---|---|---|
| `aws_region` | string | `eu-west-1` | — | Région AWS |
| `env` | string | `dev` | ∈ {`dev`,`staging`,`prod`} | Environnement |
| `app_name` | string | `finops` | — | Préfixe des ressources |
| `vpc_cidr` | string | `10.0.0.0/16` | — | CIDR du VPC |
| `az_count` | number | `2` | — | Nombre d'AZ (≥ 2 recommandé pour HA ALB) |
| `container_cpu` | number | `512` | — | CPU Fargate (unités : 512 = 0.5 vCPU) |
| `container_memory` | number | `2048` | — | Mémoire Fargate (MiB) |
| `desired_count` | number | `1` | — | Nombre de tâches ECS actives |
| `app_port` | number | `8080` | — | Port du conteneur |
| `image_tag` | string | `latest` | — | Tag Docker à déployer (surchargé par `deploy.sh` avec le git SHA) |
| `certificate_arn` | string | `""` | — | ARN ACM pour HTTPS. Si vide → HTTP-only |
| `health_check_path` | string | `/health` | — | Path du health check ALB |
| `google_client_id` | string | `""` | — | OAuth2 (voir § Secrets) |
| `google_client_secret` | string | `""` | `sensitive = true` | OAuth2 secret · **ne jamais committer** |
| `google_redirect_uri` | string | `""` | — | Ex : `https://api.…/api/gcp/callback` |
| `frontend_url` | string | `""` | — | Ex : `https://finopsgcp.vercel.app` |

### Outputs (`outputs.tf`)

Consommés par `deploy.sh` via `terraform output -raw <nom>` :

| Output | Exemple |
|---|---|
| `alb_dns_name` | `finops-alb.example.com` |
| `api_base_url` | `http://finops-dev-alb-…elb.amazonaws.com` (HTTP-only tant que cert non fourni) |
| `ecr_repository_url` | `<account>.dkr.ecr.eu-west-1.amazonaws.com/finops-dev-backend` |
| `ecs_cluster_name` | `finops-dev-cluster` |
| `ecs_service_name` | `finops-dev-service` |
| `cloudwatch_log_group` | `/ecs/finops-dev` |
| `ecr_push_policy_arn` | `arn:aws:iam::<account>:policy/finops-dev-ecr-push` |
| `aws_region` | `eu-west-1` |

---

## Prérequis & première utilisation

### Prérequis

- Terraform ≥ 1.6
- AWS CLI v2 configuré (`aws configure` ou variables d'env / rôle IAM assumé)
- Docker (avec buildx pour cible `linux/amd64`)
- `jq` (utilisé par `deploy.sh`)
- Certificat ACM pré-provisionné dans `eu-west-1` **si HTTPS souhaité** (facultatif au démarrage)

### Bootstrap

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars

# Éditer terraform.tfvars avec vos valeurs.
# NE PAS y mettre google_client_secret en clair.
# À la place, exporter :
export TF_VAR_google_client_secret="…"

terraform init
terraform apply
```

### Migration vers un backend S3 (recommandé pour staging/prod)

Le bloc `terraform {}` de `main.tf` contient un `backend "s3"` commenté. Avant d'activer :

1. Créer manuellement le bucket S3 et la table DynamoDB pour le locking (par exemple `demo-finops-tfstate` + `demo-finops-tflock`).
2. Décommenter le bloc `backend "s3"` dans `main.tf`.
3. Renseigner `bucket`, `key`, `region`, `dynamodb_table`, `encrypt = true`.
4. Migrer le state existant : `terraform init -migrate-state`.

---

## Cycle de déploiement (`deploy.sh`)

Script à la racine du repo. Séquence 6 étapes :

```bash
./deploy.sh --env dev --region eu-west-1 [--tag v1.2.3]
```

### 1. Terraform apply ciblé (ECR + VPC endpoints)

```bash
terraform apply \
  -var "env=${ENV}" -var "aws_region=${REGION}" \
  -target=aws_ecr_repository.app \
  -target=aws_vpc_endpoint.ecr_api \
  -target=aws_vpc_endpoint.ecr_dkr \
  -target=aws_vpc_endpoint.logs \
  -target=aws_vpc_endpoint.s3 \
  -auto-approve
```

⚠️ Les 4 targets `aws_vpc_endpoint.*` **n'existent pas actuellement** (voir [Gaps connus](#gaps-connus--todo-avant-prod)) — elles sont ignorées silencieusement par Terraform. Seul `aws_ecr_repository.app` est effectivement appliqué à cette étape.

Puis lecture des outputs :

```bash
ECR_URL=$(terraform output -raw ecr_repository_url)
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)
API_URL=$(terraform output -raw api_base_url)
```

### 2. Docker build

```bash
cd back
docker build --platform linux/amd64 \
  --tag "${ECR_URL}:${TAG}" \
  --tag "${ECR_URL}:latest" .
```

`TAG` par défaut = `git rev-parse --short HEAD` (ou `latest` si pas dans un repo git).

### 3. ECR login & push

```bash
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

docker push "${ECR_URL}:${TAG}"
docker push "${ECR_URL}:latest"
```

### 4. Terraform apply complet (nouvelle task definition)

```bash
terraform apply \
  -var "image_tag=${TAG}" \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -auto-approve
```

Crée une nouvelle révision de `aws_ecs_task_definition.app` pointant vers l'image poussée. Le service ECS ne redémarre pas encore (grâce à `lifecycle.ignore_changes = [task_definition]`).

### 5. Force new deployment

```bash
TASK_DEF=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --region "$REGION" \
  --query 'services[0].taskDefinition' --output text)

aws ecs update-service \
  --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$TASK_DEF" \
  --force-new-deployment --region "$REGION"
```

Trigge le rolling deployment (min 50%, max 200% healthy) avec circuit breaker actif.

### 6. Wait for stability

```bash
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"
```

Attend jusqu'à 5 min. En cas d'échec (task ne devient pas healthy), le circuit breaker rollback automatiquement.

---

## Sécurité — IAM, SG, secrets

### IAM

**Execution role** (`finops-<env>-ecs-execution-role`)  
Assumé par le service `ecs-tasks.amazonaws.com`. Policy AWS-managed `AmazonECSTaskExecutionRolePolicy` :

- `ecr:GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`
- `logs:CreateLogStream`, `PutLogEvents`

**Task role** (`finops-<env>-ecs-task-role`)  
Assumé par le conteneur applicatif. Policy custom **least privilege** :

- `logs:CreateLogStream`, `logs:PutLogEvents` sur `/ecs/finops-<env>:*` **uniquement**
- **Aucun accès** à S3, DynamoDB, Secrets Manager, Cost Explorer

> Pour ajouter Cost Explorer côté AWS ou Secrets Manager (recommandé pour OAuth secrets), étendre la policy dans `iam.tf`.

**ECR push policy** (`finops-<env>-ecr-push`)  
À attacher manuellement au user/rôle CI/CD. Permet uniquement les opérations sur le repository ECR de ce projet + `ecs:UpdateService` sur le service.

### Security Groups

```
Internet → ALB (SG allow 80/443 from 0.0.0.0/0)
              │
              ▼
              ECS (SG allow 8080 from ALB SG only)
              │
              ▼ (egress all)
              ECR pull · CloudWatch logs · Google API · AWS Cost Explorer
```

L'egress est `0.0.0.0/0` sur le SG ECS. Le trafic sortant vers ECR et CloudWatch traverse l'IGW (pas de VPC endpoints — voir gaps).

### Secrets — bonnes pratiques

⚠️ **Ne jamais committer `terraform.tfvars` avec des valeurs secrètes.**

Options (par ordre de préférence) :

1. **AWS Secrets Manager** (recommandé pour prod) : stocker `google_client_secret` dans Secrets Manager, référencer via `secrets = [{ name = "GOOGLE_CLIENT_SECRET", valueFrom = "arn:aws:secretsmanager:…" }]` dans la task definition. Étendre le task role avec `secretsmanager:GetSecretValue`.
2. **Variables `TF_VAR_*`** au moment de `terraform apply` :
   ```bash
   export TF_VAR_google_client_secret="…"
   terraform apply
   ```
3. **`terraform.tfvars` local (jamais committé)** : ajouter au `.gitignore` (déjà présent).

Si un secret a été committé accidentellement, il est **considéré compromis** dès l'instant du push — rotation immédiate obligatoire (Sia security policy).

---

## Monitoring & auto-scaling

### CloudWatch Log Group

- Nom : `/ecs/finops-<env>`
- Retention : **30 jours en prod**, **7 jours en dev/staging**

### CloudWatch Alarms

| Nom | Métrique | Seuil | Évaluation |
|---|---|---|---|
| `finops-<env>-cpu-high` | `ECSService.CPUUtilization` (avg) | > 80% | 2 × 60 s |
| `finops-<env>-memory-high` | `ECSService.MemoryUtilization` (avg) | > 80% | 2 × 60 s |
| `finops-<env>-alb-5xx` | `ALB.HTTPCode_Target_5XX_Count` (sum) | > 10 / min | 1 × 60 s |
| `finops-<env>-unhealthy-hosts` | `ALB.UnHealthyHostCount` (avg) | > 0 | 1 × 60 s |

Traitement des données manquantes : `notBreaching`.

⚠️ **Aucune `alarm_actions` n'est configurée** — les alarmes se déclenchent mais ne notifient personne. Pour brancher SNS/Slack/PagerDuty, ajouter dans `cloudwatch.tf` :

```hcl
alarm_actions = [aws_sns_topic.alerts.arn]
ok_actions    = [aws_sns_topic.alerts.arn]
```

### Auto-scaling

Target tracking basé sur deux métriques :

- `ECSServiceAverageCPUUtilization` — target 60%
- `ECSServiceAverageMemoryUtilization` — target 70%

Cooldowns : scale-out 60 s, scale-in 300 s.

Bornes :
- **prod** : min=1, max=2
- **dev/staging** : min=1, max=1 (auto-scaling effectivement désactivé)

---

## Gaps connus & TODO avant prod

Points relevés lors de l'audit — à traiter avant un déploiement production sérieux.

| Sévérité | Sujet | Détail | Action |
|---|---|---|---|
| **Critique** | State en local | `terraform.tfstate` non protégé, pas de locking, pas de versioning. Risque de corruption / perte / conflits multi-user | Activer backend S3 + DynamoDB (bloc déjà présent dans `main.tf`, commenté). Créer bucket + table puis `terraform init -migrate-state` |
| **Critique** | `vpc_endpoints.tf` vide | `deploy.sh` cible `aws_vpc_endpoint.{ecr_api, ecr_dkr, logs, s3}` mais aucune ressource n'existe. Silencieusement ignoré | Soit implémenter les 4 endpoints (économies data transfer + sécurité), soit retirer les `-target` de `deploy.sh` |
| **Critique** | Secrets en clair | Si `terraform.tfvars` a jamais contenu / a été committé avec `google_client_secret`, il est compromis | Rotation immédiate + migrer vers Secrets Manager ou `TF_VAR_*` |
| **Élevé** | HSTS + HTTPS désactivés | `certificate_arn = ""` → ALB en HTTP-only. Trafic non chiffré | Provisionner un cert ACM dans `eu-west-1`, renseigner `certificate_arn` |
| **Élevé** | Alarmes sans actions | Les 4 alarmes ne déclenchent aucune notification | Créer `aws_sns_topic.alerts` + subscriptions email/Slack, brancher via `alarm_actions` |
| **Moyen** | Tâches en subnets publics | Assignation d'IP publique aux tâches Fargate. SG restreint l'accès, mais surface d'attaque non-nulle | Ajouter subnets privés + NAT gateway (~35 €/mois/AZ) et basculer `assign_public_ip = false` |
| **Moyen** | `readonlyRootFilesystem = false` | Le conteneur peut écrire n'importe où | Passer à `true` + monter tmpfs pour `/tmp` |
| **Moyen** | Auto-scaling max=1 en dev | Aucune tolérance à la panne en dev/staging | Envisager max=2 en staging pour tester le comportement multi-tâches |
| **Faible** | `containerInsights = disabled` | Pas de métriques applicatives détaillées côté ECS | Activer si besoin d'observabilité fine (coût ~10 €/mois) |

---

## Références

- Backend Docker & health checks : [`../back/README.md`](../back/README.md)
- Script de déploiement : [`../deploy.sh`](../deploy.sh)
- Vue globale du projet : [`../README.md`](../README.md)
- Guide IA : [`../CLAUDE.md`](../CLAUDE.md)
