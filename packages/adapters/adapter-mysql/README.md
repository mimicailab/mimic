# @mimicai/adapter-mysql

MySQL database adapter for [Mimic](https://github.com/mimicailab/mimic) — seeds tables with persona-consistent data and relational integrity.

## Install

```bash
npm install @mimicai/adapter-mysql
```

## Usage

```json
{
  "databases": [
    {
      "adapter": "mysql",
      "connectionString": "mysql://root:password@localhost:3306/testdb"
    }
  ]
}
```

## License

[Apache 2.0](../../../LICENSE-APACHE-2.0)
