FROM public.ecr.aws/lambda/nodejs:20

RUN dnf install -y gcc gcc-c++ python3 java-17-amazon-corretto-devel \
    && dnf clean all \
    && rm -rf /var/cache/dnf

COPY index.mjs ${LAMBDA_TASK_ROOT}/index.mjs

CMD ["index.handler"]
