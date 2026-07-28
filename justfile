export AWS_ACCESS_KEY_ID := "test"
export AWS_SECRET_ACCESS_KEY := "test"
export AWS_DEFAULT_REGION := "us-east-1"

compose := "docker compose -f examples/gateway-v2-access-logging/docker-compose.yml"

# List available recipes
default:
    @just --list

# Start LocalStack in the background
up:
    {{ compose }} up -d

# Wait for LocalStack to be healthy
wait:
    @echo "Waiting for LocalStack to be ready..."
    @until curl -sf http://localhost:4566/_localstack/health > /dev/null 2>&1; do sleep 1; done
    @echo "LocalStack is ready"

# Bootstrap the CDK toolkit against LocalStack (run once after `just up`)
bootstrap:
    cdklocal bootstrap

# Deploy the example stack to LocalStack
deploy:
    cdklocal deploy --require-approval never

# Destroy the example stack in LocalStack
destroy:
    cdklocal destroy --force

# Stop LocalStack and remove the volume
down:
    {{ compose }} down -v

# Full lifecycle: up → wait → bootstrap → deploy
start: up wait bootstrap deploy
