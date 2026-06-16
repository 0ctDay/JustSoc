FROM crpi-3k5gato5pgtkwnbt.cn-beijing.personal.cr.aliyuncs.com/vulstest/kafka-3.7.0

USER root

RUN sed -i 's/if \[\[ -z "${!1}" \]\]; then/if [[ -z "${!1-}" ]]; then/' /etc/kafka/docker/configure

COPY kafka_server_jaas.conf /opt/kafka/config/kafka_server_jaas.conf

ENV KAFKA_OPTS="-Djava.security.auth.login.config=/opt/kafka/config/kafka_server_jaas.conf"

USER appuser
