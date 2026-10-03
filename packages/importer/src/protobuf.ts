// Independent wire-format reader. Field numbers verified against Anki's upstream
// import_export.proto and notetypes.proto; no Anki implementation is bundled.
export type ProtoValue = bigint | Uint8Array;
export function protobuf(bytes: Uint8Array): Map<number, ProtoValue[]> {
  let pos = 0;
  const result = new Map<number, ProtoValue[]>();
  const varint = () => {
    let n = 0n,
      shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new Error("Truncated protobuf value.");
      const b = bytes[pos++];
      n |= BigInt(b & 127) << shift;
      if (!(b & 128)) return n;
      shift += 7n;
    }
    throw new Error("Invalid protobuf integer.");
  };
  while (pos < bytes.length) {
    const tag = Number(varint()),
      field = tag >>> 3,
      wire = tag & 7;
    if (!field) throw new Error("Invalid protobuf field.");
    let value: ProtoValue;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const len = Number(varint());
      if (!Number.isSafeInteger(len) || len < 0 || pos + len > bytes.length)
        throw new Error("Truncated protobuf message.");
      value = bytes.slice(pos, pos + len);
      pos += len;
    } else if (wire === 1 || wire === 5) {
      const len = wire === 1 ? 8 : 4;
      if (pos + len > bytes.length)
        throw new Error("Truncated protobuf fixed value.");
      value = bytes.slice(pos, pos + len);
      pos += len;
    } else throw new Error("Unsupported protobuf wire type.");
    const values = result.get(field) ?? [];
    values.push(value);
    result.set(field, values);
  }
  return result;
}
export const protoText = (m: Map<number, ProtoValue[]>, field: number) => {
  const b = m.get(field)?.[0];
  return b instanceof Uint8Array ? new TextDecoder().decode(b) : "";
};
export const protoNum = (m: Map<number, ProtoValue[]>, field: number) =>
  Number(m.get(field)?.[0] ?? 0n);
