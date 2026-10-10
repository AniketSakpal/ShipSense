import {
  verifyBlueRouteSignature,
  verifySwiftShipSignature,
} from "../src/security/webhook.signature";

const swiftBody =
  '{"event_id":"ss_evt_000123","awb":"SS1002003004","order_ref":"ORD-90017","status":"OFD","status_detail":"Out for delivery","location":"Mumbai-Andheri Hub","pincode":"400053","event_time":"2026-10-05 09:05:00","attempt_no":1,"cod_amount":"849.00"}';

const swiftResult = verifySwiftShipSignature(
  Buffer.from(swiftBody, "utf8"),
  "sha256=48be82a6cb0e3fbbfec512ef7680b25a7471b05a73d2e6a1c0dfc27364b1ac49",
  "swiftship-demo-secret",
);

console.log("SwiftShip valid vector:", swiftResult);

const blueBody =
  '{"tracking_number":"BR778899","reference":"ORD-91002","code":35,"message":"Delivery failed","ts":1791196500000,"hub":"BOM-ANH-02","cod_amount_paise":84900,"meta":{"reason_code":"CNA"}}';

const blueTimestamp = "1791196800";

const blueResult = verifyBlueRouteSignature(
  Buffer.from(blueBody, "utf8"),
  blueTimestamp,
  "TYytPAJqu6aJjjgz/WNNfySd5TWFRDFuVgs6lkMNv2o=",
  "blueroute-demo-secret",
  {
    // Fixed assignment test time: 2026-10-05 10:40:00 UTC.
    nowSeconds: () => 1791196800,
  },
);

console.log("BlueRoute valid vector:", blueResult);

// A modified body must fail verification.
const tamperedResult = verifySwiftShipSignature(
  Buffer.from(swiftBody + " ", "utf8"),
  "sha256=48be82a6cb0e3fbbfec512ef7680b25a7471b05a73d2e6a1c0dfc27364b1ac49",
  "swiftship-demo-secret",
);

console.log("Tampered SwiftShip body:", tamperedResult);