# Practice compiler Lambda image

This container is the platform-owned runtime used when a tenant enables the
Practice compiler. It supports C, C++, Python and Java and returns the same
structured result as the existing server runner.

Build and publish a versioned image before approving a compiler-enabled tenant:

```bash
aws ecr create-repository --repository-name eproc/compiler
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.ap-southeast-1.amazonaws.com
docker build --platform linux/amd64 -t eproc-compiler:v1 .
docker tag eproc-compiler:v1 ACCOUNT.dkr.ecr.ap-southeast-1.amazonaws.com/eproc/compiler:v1
docker push ACCOUNT.dkr.ecr.ap-southeast-1.amazonaws.com/eproc/compiler:v1
```

Set `TENANT_COMPILER_IMAGE_URI` on the control-plane host to that immutable tag.
The image URI is intentionally not editable by tenant administrators.

The child process receives a clean environment without Lambda credentials or
application secrets. Output, source, stdin, execution time and tenant concurrency
are bounded. The Lambda execution role can only write to its own CloudWatch log
group. This runner is suitable for controlled training workloads; review network
egress and stronger language-specific sandboxing before exposing it publicly.

COBOL remains available through the legacy EC2 runner when Lambda mode is off. To
support COBOL in Lambda mode, publish a separately reviewed image containing
GNUCobol and add `cobol` to both backend and image language allowlists.
