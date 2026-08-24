
DEVICE_ID="wb00-000123"

# 1. 生成设备私钥
openssl genpkey -algorithm RSA -out ${DEVICE_ID}.key -pkeyopt rsa_keygen_bits:2048

# 2. 生成 CSR（CN 必须为设备 ID）
openssl req -new -key ${DEVICE_ID}.key -out ${DEVICE_ID}.csr \
  -subj "/CN=${DEVICE_ID}"

# 3. 使用根 CA 签发设备证书（有效期 3 年）
openssl x509 -req -in ${DEVICE_ID}.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out ${DEVICE_ID}.crt -days 3650 -sha256
